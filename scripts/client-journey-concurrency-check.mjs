import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';

// Invoked only with the disposable database owned by scripts/test-postgres.mjs.
export async function verifyClientJourneyConcurrency(connection) {
  if (!['127.0.0.1','localhost'].includes(connection.host) || !String(connection.database).startsWith('akrasia_a05_')) throw new Error('Disposable client-journey database required');
  const admin=new pg.Client(connection);await admin.connect();const clients=[];const lead=randomUUID(),draft=randomUUID();const operations=[];let journey,queue,task;
  const operation=()=>{const id=randomUUID();operations.push(id);return id;};
  try {
    await admin.query('INSERT INTO public.leads(id,name,email,project_type) VALUES($1,$2,$3,$4)',[lead,'Synthetic concurrent client','concurrent@example.invalid','Synthetic']);
    for (let i=0;i<6;i++){const client=new pg.Client(connection);await client.connect();await client.query('SET ROLE service_role');clients.push(client);}
    const created=await Promise.all(clients.map(client=>client.query('SELECT public.dashboard_create_client_journey($1,$2,$3,$4,$5) AS result',[lead,operation(),'Synthetic concurrent client','Synthetic private project','Only disposable concurrency data'])));journey=created[0].rows[0].result;
    for (const result of created) assert.equal(result.rows[0].result.id,journey.id);assert.equal((await admin.query('SELECT count(*)::int AS total FROM public.client_journeys WHERE lead_id=$1',[lead])).rows[0].total,1);
    const fields={to_email:'concurrent@example.invalid',to_name:'Synthetic',subject:'Synthetic email',body_text:'This is only a test draft.',template_type:'evaluation',journey_id:journey.id,lead_id:null,client_id:null,project_id:null};
    await clients[0].query('SELECT public.dashboard_save_email_draft($1,0,$2,$3)',[draft,operation(),fields]);
    const saved=await Promise.allSettled(clients.slice(0,2).map((client,i)=>client.query('SELECT public.dashboard_save_email_draft($1,1,$2,$3)',[draft,operation(),{...fields,subject:`Concurrent edit ${i}`}])));
    assert.equal(saved.filter(result=>result.status==='fulfilled').length,1);assert.equal(saved.filter(result=>result.status==='rejected'&&result.reason.code==='PT409').length,1);
    const queued=await Promise.all(clients.map(client=>client.query('SELECT public.dashboard_queue_email_draft($1,2,$2) AS result',[draft,operation()])));queue=queued[0].rows[0].result.queue_id;
    for (const result of queued) assert.equal(result.rows[0].result.queue_id,queue);
    assert.equal((await admin.query('SELECT count(*)::int AS total FROM public.integration_outbox WHERE idempotency_key=$1',[`email-draft:${draft}:2`])).rows[0].total,1);
    assert.equal((await admin.query("SELECT count(*)::int AS total FROM public.client_journey_events WHERE journey_id=$1 AND event_type='email_queued'",[journey.id])).rows[0].total,1);
    assert.equal((await admin.query('SELECT is_published FROM public.projects WHERE id=$1',[journey.project_id])).rows[0].is_published,false);
    const advanced=await Promise.all(clients.map(client=>client.query('SELECT public.dashboard_update_client_journey($1,$2,$3) AS result',[journey.id,operation(),{stage:'evaluating'}])));
    for(const result of advanced)assert.equal(result.rows[0].result.stage,'evaluating');
    assert.equal((await admin.query("SELECT count(*)::int AS total FROM public.client_journey_events WHERE journey_id=$1 AND event_type='stage_changed'",[journey.id])).rows[0].total,1);
    const update=(stage,changes={})=>clients[0].query('SELECT public.dashboard_update_client_journey($1,$2,$3)',[journey.id,operation(),{stage,...changes}]);
    await update('quote_preparation',{budget_amount:1500,budget_currency:'EUR',budget_scope:'Synthetic animation, two revisions.',budget_timing:'Ten working days from approval.'});
    await update('quote_sent',{note:'Team verified the quote sending.'});await update('accepted',{note:'Client confirms the quote.'});
    task=(await admin.query("INSERT INTO public.project_tasks(project_id,title,status) VALUES($1,'Synthetic production work','completed') RETURNING id",[journey.project_id])).rows[0].id;
    await update('in_production');await update('review');
    // Task edits and milestone checks share a project lock. A pending edit that
    // commits first must be seen by the waiting delivery transaction.
    await clients[0].query('BEGIN');await clients[0].query("UPDATE public.project_tasks SET status='pending' WHERE id=$1",[task]);
    const pid=(await clients[1].query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const waitingDelivery=clients[1].query('SELECT public.dashboard_update_client_journey($1,$2,$3)',[journey.id,operation(),{stage:'delivered',note:'Synthetic attempted delivery.'}]).then(()=>({ok:true}),error=>({ok:false,code:error.code}));
    let blocked=false;
    for(let attempt=0;attempt<50;attempt++){
      const activity=(await admin.query('SELECT wait_event_type,wait_event FROM pg_catalog.pg_stat_activity WHERE pid=$1',[pid])).rows[0];
      if(activity?.wait_event_type==='Lock' && activity?.wait_event==='advisory'){blocked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(blocked,true,'Delivery waits for the pending production edit');
    await clients[0].query('COMMIT');
    const failedDelivery=await waitingDelivery;assert.equal(failedDelivery.ok,false);assert.equal(failedDelivery.code,'PT400');
    assert.equal((await admin.query('SELECT stage FROM public.client_journeys WHERE id=$1',[journey.id])).rows[0].stage,'review');
    assert.equal((await admin.query('SELECT status FROM public.projects WHERE id=$1',[journey.project_id])).rows[0].status,'post_production');
    await admin.query("UPDATE public.project_tasks SET status='completed' WHERE id=$1",[task]);await update('delivered',{note:'Synthetic final master confirmed.'});
    await assert.rejects(clients[1].query("UPDATE public.project_tasks SET status='pending' WHERE id=$1",[task]),error=>error.code==='PT409');
    assert.equal((await admin.query('SELECT status FROM public.project_tasks WHERE id=$1',[task])).rows[0].status,'completed');
    console.log('PASS client journey concurrency: one client/project and queued email, stale save rejected, one milestone across six operations, pending task race prevents delivery.');
    return {clients:clients.length,assertions:35};
  } finally {
    for (const client of clients)await client.end().catch(()=>{});
    await admin.query('DELETE FROM public.email_drafts WHERE id=$1',[draft]);
    if (queue) {await admin.query('DELETE FROM public.sent_emails WHERE operation_id=$1',[queue]);await admin.query('DELETE FROM public.integration_outbox WHERE id=$1',[queue]);}
    await admin.query('DELETE FROM public.client_journey_operations WHERE id=ANY($1::uuid[])',[operations]);
    if(journey){await admin.query('DELETE FROM public.client_journeys WHERE id=$1',[journey.id]);await admin.query('DELETE FROM public.projects WHERE id=$1',[journey.project_id]);await admin.query('DELETE FROM public.clients WHERE id=$1',[journey.client_id]);}
    await admin.query('DELETE FROM public.leads WHERE id=$1',[lead]);await admin.end();
  }
}
