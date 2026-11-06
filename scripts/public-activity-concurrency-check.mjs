import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
/** No discovery/DSN: only the new disposable loopback cluster from the runner. */
export async function verifyPublicActivityConcurrency(connection) {
 if(!['127.0.0.1','localhost','::1'].includes(connection.host)||connection.database!=='akrasia_a05_integrated')throw new Error('Disposable activity concurrency database required.');
 const admin=new pg.Client(connection),first=new pg.Client(connection),second=new pg.Client(connection);
 await Promise.all([admin.connect(),first.connect(),second.connect()]);let checks=0;
 const project=randomUUID(),entry=randomUUID();const check=value=>{checks++;assert.ok(value);};
 async function waitForLock(pid){for(let attempt=0;attempt<100;attempt++){if((await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){check(true);return;}await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Activity race did not reach the intended row lock.');}
 try {
  await admin.query("INSERT INTO public.projects(id,title,slug,is_published) VALUES($1,'Synthetic activity concurrency',$2,true)",[project,`activity-race-${project}`]);
  await admin.query("INSERT INTO public.feed_entries(id,project_id,text,public_title,public_title_en,public_text,public_text_en,public_occurred_at) VALUES($1,$2,'PRIVATE','Title','Title','Editorial','Editorial','2026-01-01T00:00:00Z')",[entry,project]);
  const secondPid=(await second.query('SELECT pg_backend_pid() AS id')).rows[0].id;
  await first.query('BEGIN');await first.query('UPDATE public.projects SET is_published=false WHERE id=$1',[project]);
  await second.query('BEGIN');let failure;
  const approval=second.query('UPDATE public.feed_entries SET is_published=true WHERE id=$1',[entry]).catch(error=>{failure=error;});
  await waitForLock(secondPid);await first.query('COMMIT');await approval;check(!!failure);await second.query('ROLLBACK');
  check((await admin.query('SELECT is_published FROM public.feed_entries WHERE id=$1',[entry])).rows[0].is_published===false);
  await admin.query('UPDATE public.projects SET is_published=true WHERE id=$1',[project]);
  // An approval that wins the lock completes first; withdrawal then revokes it.
  await first.query('BEGIN');await first.query('UPDATE public.feed_entries SET is_published=true WHERE id=$1',[entry]);
  await second.query('BEGIN');const withdrawal=second.query('UPDATE public.projects SET is_published=false WHERE id=$1',[project]);
  await waitForLock(secondPid);await first.query('COMMIT');await withdrawal;await second.query('COMMIT');
  check((await admin.query('SELECT is_published FROM public.feed_entries WHERE id=$1',[entry])).rows[0].is_published===false);
  await admin.query('UPDATE public.projects SET is_published=true WHERE id=$1',[project]);
  check((await admin.query('SELECT is_published FROM public.feed_entries WHERE id=$1',[entry])).rows[0].is_published===false);
  const revision=(await admin.query('SELECT public_revision FROM public.feed_entries WHERE id=$1',[entry])).rows[0].public_revision;
  await second.query("UPDATE public.feed_entries SET public_text='Updated by another editor' WHERE id=$1",[entry]);
  check((await first.query('UPDATE public.feed_entries SET is_published=true WHERE id=$1 AND public_revision=$2',[entry,revision])).rowCount===0);
  console.log(`PASS public activity concurrency: ${checks} real assertions; both withdrawal lock orders and stale editorial approval.`);
  return {assertions:checks};
 } finally {
  await first.query('ROLLBACK').catch(()=>{});await second.query('ROLLBACK').catch(()=>{});
  await admin.query('DELETE FROM public.feed_entries WHERE id=$1',[entry]).catch(()=>{});await admin.query('DELETE FROM public.projects WHERE id=$1',[project]).catch(()=>{});
  await Promise.all([admin.end(),first.end(),second.end()]);
 }
}
