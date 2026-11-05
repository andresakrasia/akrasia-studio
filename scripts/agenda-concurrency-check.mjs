import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
/** Only called by the disposable-cluster runner; no .env or supplied remote URL. */
export async function verifyAgendaConcurrency(config) {
  assert.equal(config.host,'127.0.0.1');assert.match(config.database,/^akrasia_a05_integrated$/);
  const admin=new pg.Client(config), a=new pg.Client(config), b=new pg.Client(config);await Promise.all([admin.connect(),a.connect(),b.connect()]);
  const visitorA=randomUUID(),visitorB=randomUUID(),firstId=randomUUID(),secondId=randomUUID();let slotId;let day;
  const makePayload=(id,owner)=>({id,visitor_id:owner,booked_date:day,booked_time:'15:00',duration_min:30,buffer_min:30,meet_url:'https://example.invalid/meeting',visitor_email:'synthetic@example.invalid',visitor_name:'Synthetic concurrency'});
  const invoke=(client,owner,id)=>client.query('SELECT public.booking_create_once($1,EXTRACT(EPOCH FROM clock_timestamp())::bigint+3600,0,$2::jsonb) AS value',[owner,JSON.stringify(makePayload(id,owner))]);
  try {
    day=(await admin.query("SELECT to_char((clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date+12,'YYYY-MM-DD') AS day")).rows[0].day;
    slotId=(await admin.query("INSERT INTO public.availability(day_of_week,start_time,end_time,is_active) VALUES(EXTRACT(DOW FROM $1::date),'14:00','18:00',true) RETURNING id",[day])).rows[0].id;
    await a.query('BEGIN');await b.query('BEGIN');const first=(await invoke(a,visitorA,firstId)).rows[0].value;assert.equal(first.created,true);
    let secondFinished=false;const second=invoke(b,visitorB,secondId).then(result=>{secondFinished=true;return result;});
    await a.query('SELECT pg_sleep(0.15)');assert.equal(secondFinished,false,'second proposal waits for real transaction lock');
    assert.equal((await admin.query('SELECT count(*)::int n FROM public.bookings WHERE id=$1',[firstId])).rows[0].n,0,'uncommitted reservation is invisible');
    await a.query('COMMIT');const rejected=(await second).rows[0].value;assert.equal(rejected.booking,null);await b.query('COMMIT');
    assert.equal((await admin.query('SELECT count(*)::int n FROM public.bookings WHERE id=ANY($1::uuid[])',[[firstId,secondId]])).rows[0].n,1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM public.integration_outbox WHERE booking_id=$1',[firstId])).rows[0].n,2);
    const replay=(await invoke(admin,visitorA,firstId)).rows[0].value;assert.equal(replay.created,false);assert.equal(replay.booking.id,firstId);
    // The exclusion constraint still protects integrity when the application
    // trigger is deliberately disabled by the owner in this throwaway cluster.
    await admin.query('ALTER TABLE public.bookings DISABLE TRIGGER bookings_guard');
    await a.query('BEGIN');await b.query('BEGIN');
    const directA=randomUUID(),directB=randomUUID();
    const insert=(client,id,owner)=>client.query("INSERT INTO public.bookings(id,visitor_id,booked_date,booked_time,duration_min,buffer_min,status) VALUES($1,$2,$3,'16:30',30,30,'confirmed')",[id,owner,day]);
    await a.query('INSERT INTO public.visitors(visitor_id) VALUES($1) ON CONFLICT DO NOTHING',[visitorA]);
    await b.query('INSERT INTO public.visitors(visitor_id) VALUES($1) ON CONFLICT DO NOTHING',[visitorB]);
    await insert(a,directA,visitorA);const conflict=insert(b,directB,visitorB).catch(error=>error);
    await a.query('SELECT pg_sleep(0.1)');await a.query('COMMIT');const error=await conflict;assert.equal(error.code,'23P01');await b.query('ROLLBACK');
    await admin.query('DELETE FROM public.bookings WHERE id=$1',[directA]);await admin.query('ALTER TABLE public.bookings ENABLE TRIGGER bookings_guard');
    return {checks:13,scope:'Real two-connection transaction blocking, atomic outbox, replay and independent exclusion constraint'};
  } finally {
    await Promise.all([a.query('ROLLBACK').catch(()=>{}),b.query('ROLLBACK').catch(()=>{})]);
    await admin.query('ALTER TABLE public.bookings ENABLE TRIGGER bookings_guard').catch(()=>{});
    await admin.query('DELETE FROM public.bookings WHERE visitor_id=ANY($1::text[])',[[visitorA,visitorB]]).catch(()=>{});
    await admin.query('DELETE FROM public.chat_context_states WHERE visitor_id=ANY($1::text[])',[[visitorA,visitorB]]).catch(()=>{});
    await admin.query('DELETE FROM public.visitors WHERE visitor_id=ANY($1::text[])',[[visitorA,visitorB]]).catch(()=>{});
    if(slotId) await admin.query('DELETE FROM public.availability WHERE id=$1',[slotId]).catch(()=>{});
    await Promise.all([admin.end(),a.end(),b.end()]);
  }
}
