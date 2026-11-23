import { randomUUID } from 'node:crypto';

// Independent synchronous transaction double for local fictitious records.
// It does not execute SQL or verify deployed RLS/transactions.
export function createLifecycleFixture(tables, states, now, leases = () => tables.chat_concurrency_leases || []) {
  const remove = (table, predicate) => { const original = tables[table] ||= []; const victims = original.filter(predicate); for(let index=original.length-1;index>=0;index--)if(predicate(original[index]))original.splice(index,1); return victims; };
  const ensure = body => {
    if (!states.has(body.p_visitor_id)) states.set(body.p_visitor_id, { contextVersion: 0, expiresAt: body.p_expires_at, cleanupAfter: body.p_expires_at * 1000 + 604800000 });
    return states.get(body.p_visitor_id);
  };
  const stale = (state, body) => state.contextVersion !== body.p_context_version;
  const operations=tables.chat_turn_operations||=([]);
  function rpc(name, body) {
    if (name === 'chat_context_state') return { ...ensure(body) };
    if (name === 'chat_erase_context') {
      const state = ensure(body);
      if (state.contextVersion === body.p_context_version + 1 && state.lastEraseFrom === body.p_context_version) return { ...state };
      if (stale(state, body)) return { error: 'chat_context_changed' };
      const active = leases().filter(row => row.session_key === body.p_session_key && Date.parse(row.expires_at) > now());
      if (active.length) return { error: 'chat_busy', retry_after: Math.max(1,Math.min(3600,Math.ceil((Math.min(...active.map(row=>Date.parse(row.expires_at)))-now())/1000))) };
      const owner = body.p_visitor_id;
      const conversations = new Set(tables.conversations.filter(row => row.visitor_id === owner).map(row => row.id));
      const leads = new Set(tables.leads.filter(row => row.visitor_id === owner && (row.source || 'web') === 'web').map(row => row.id));
      for (const row of tables.bookings || []) if (row.visitor_id === owner) { if (conversations.has(row.conversation_id)) row.conversation_id = null; if (leads.has(row.lead_id)) row.lead_id = null; }
      for (const row of tables.sent_emails || []) if ((!row.visitor_id || row.visitor_id === owner) && leads.has(row.lead_id)) row.lead_id = null;
      remove('messages', row => conversations.has(row.conversation_id)); remove('conversations', row => row.visitor_id === owner); remove('leads', row => leads.has(row.id));
      for(let i=operations.length-1;i>=0;i--)if(operations[i].visitor_id===owner&&operations[i].status==='complete')operations.splice(i,1);
      for (const row of tables.leads) if (row.visitor_id === owner) row.conversation_id = null;
      for (const row of tables.visitors || []) if (row.visitor_id === owner) Object.assign(row, { source: 'chat', page_views: 0, first_seen: new Date(now()).toISOString(), last_seen: new Date(now()).toISOString() });
      state.lastEraseFrom = body.p_context_version; state.contextVersion++; return { ...state };
    }
    if(name==='chat_claim_turn'){
      const state=ensure(body);if(stale(state,body))return {error:'chat_context_changed'};
      const existing=operations.find(row=>row.operation_id===body.p_operation_id);
      if(existing){
        if(existing.visitor_id!==body.p_visitor_id||existing.context_version!==body.p_context_version||existing.request_hash!==body.p_request_hash)return {error:'invalid_request'};
        if(existing.status==='complete')return {status:'complete',response:existing.response,action:existing.action};
        if(existing.lease_until>now())return {error:'chat_busy',retry_after:Math.max(1,Math.ceil((existing.lease_until-now())/1000))};
        existing.lease_until=now()+90000;return {status:'claimed'};
      }
      operations.push({operation_id:body.p_operation_id,visitor_id:body.p_visitor_id,context_version:body.p_context_version,request_hash:body.p_request_hash,status:'pending',lease_until:now()+90000});return {status:'claimed'};
    }
    if (name === 'chat_save_turn') {
      const state = ensure(body); if (stale(state, body)) return { error: 'chat_context_changed' };
      const operation=operations.find(row=>row.operation_id===body.p_operation_id);
      if(!operation||operation.visitor_id!==body.p_visitor_id||operation.request_hash!==body.p_request_hash)return {error:'invalid_request'};
      if(operation.status==='complete')return {saved:true,contextVersion:state.contextVersion,replayed:true};
      const owner = body.p_visitor_id; const stamp = new Date(now()).toISOString();
      let visitor = (tables.visitors || []).find(row => row.visitor_id === owner);
      if (!visitor) { visitor = { id: randomUUID(), visitor_id: owner, first_seen: stamp, last_seen: stamp, source: 'web', page_views: 1 }; (tables.visitors ||= []).push(visitor); }
      visitor.last_seen = stamp;
      let conversation = tables.conversations.find(row => row.visitor_id === owner && row.created_at.slice(0, 10) === stamp.slice(0, 10));
      if (!conversation) { conversation = { id: randomUUID(), visitor_id: owner, created_at: stamp, updated_at: stamp, message_count: 0 }; tables.conversations.push(conversation); }
      const pair=[];for (const [role, content] of [['user', body.p_user_content], ['assistant', body.p_assistant_content]]) {const row={ id: randomUUID(), conversation_id: conversation.id, role, content, created_at: stamp };pair.push(row.id);tables.messages.push(row);}
      conversation.updated_at = stamp;
      conversation.message_count = tables.messages.filter(row => row.conversation_id === conversation.id).length;
      if (body.p_lead) {
        let lead = tables.leads.find(row => row.visitor_id === owner && (row.source || 'web') === 'web');
        if (!lead) { lead = { id: randomUUID(), visitor_id: owner, source: 'web', created_at: stamp, status: 'new', tags: [], contact_captured_at: null }; tables.leads.push(lead); }
        Object.assign(lead, Object.fromEntries(Object.entries(body.p_lead).filter(([,value]) => value !== null)), { conversation_id: conversation.id, updated_at: stamp });
        if (!lead.contact_captured_at && (lead.email || lead.phone)) lead.contact_captured_at = stamp;
        if(body.p_lead.email||body.p_lead.phone||body.p_lead.interest_level==='hot') (tables.integration_outbox||=[]).push({id:randomUUID(),idempotency_key:`lead:${body.p_operation_id}:telegram`,channel:'telegram',payload:{text:`Contacto para revisión en el panel. Referencia: ${lead.id}`},visitor_id:owner,context_version:body.p_context_version,status:'queued'});
      }
      Object.assign(operation,{status:'complete',response:body.p_assistant_content,action:body.p_action||null,user_message_id:pair[0],assistant_message_id:pair[1]});
      return { saved: true, contextVersion: state.contextVersion,replayed:false };
    }
    if (name === 'chat_insert_booking') {
      const state = ensure(body); if (stale(state, body)) return { error: 'chat_context_changed' };
      if (tables.bookings.some(row => row.id === body.p_booking.id)) throw new Error('duplicate_primary_key');
      const row = { ...body.p_booking, conversation_id: null, lead_id: null, visitor_phone: null, created_at: new Date(now()).toISOString() };
      tables.bookings.push(row); return [row];
    }
    if (name === 'chat_retention_batch' || name === 'production_retention_batch') {
      if (leases().some(row=>Date.parse(row.expires_at)>now())) return { messages:0,conversations:0,profiles:0,notifications:0,bookings:0,states:0,visitors:0,quota_buckets:0,leases:0,outbox:0,chat_operations:0,dashboard_operations:0,deferred:true };
      const cutoff = days => now() - days * 86400000;
      const limit = body.p_batch_size; const count = {};
      const prune = (table, predicate) => { const ids = new Set((tables[table] || []).filter(predicate).slice(0, limit).map(row => row.id)); return remove(table, row => ids.has(row.id)); };
      const messages = prune('messages', row => Date.parse(row.created_at) < cutoff(body.p_chat_days)); count.messages = messages.length;
      const prunedIds=new Set(messages.map(row=>row.id));for(let i=operations.length-1;i>=0;i--)if(prunedIds.has(operations[i].user_message_id)||prunedIds.has(operations[i].assistant_message_id))operations.splice(i,1);
      for (const owner of new Set(messages.map(row => tables.conversations.find(c => c.id === row.conversation_id)?.visitor_id).filter(Boolean))) ensure({ p_visitor_id: owner, p_expires_at: Math.floor(now()/1000)+2592000 }).contextVersion++;
      const conversations = prune('conversations', row => Date.parse(row.updated_at) < cutoff(body.p_chat_days) && !tables.messages.some(message => message.conversation_id === row.id)); count.conversations = conversations.length;
      for (const row of [...tables.leads, ...(tables.bookings || [])]) if (conversations.some(c => c.id === row.conversation_id)) row.conversation_id = null;
      const profiles = prune('leads', row => (row.source || 'web') === 'web' && Date.parse(row.updated_at) < cutoff(body.p_profile_days)); count.profiles = profiles.length;
      for (const owner of new Set(profiles.map(row => row.visitor_id))) ensure({ p_visitor_id: owner, p_expires_at: Math.floor(now()/1000)+2592000 }).contextVersion++;
      for (const row of [...(tables.bookings || []), ...(tables.sent_emails || [])]) if (profiles.some(p => p.id === row.lead_id)) row.lead_id = null;
      count.notifications = prune('sent_emails', row => Date.parse(row.created_at) < cutoff(body.p_notification_days)).length;
      count.bookings = prune('bookings', row => ['completed','cancelled'].includes(row.status) && row.privacy_retention_until && Date.parse(row.privacy_retention_until) <= now()).length;
      count.states = 0; for (const [owner, state] of states) if (state.cleanupAfter <= now() && count.states < limit) { states.delete(owner); count.states++; }
      count.visitors = prune('visitors', row => Date.parse(row.last_seen) < cutoff(37) && !states.has(row.visitor_id) && !['conversations','leads','bookings','sent_emails'].some(table => (tables[table] || []).some(value => value.visitor_id === row.visitor_id))).length;
      count.quota_buckets = prune('chat_quota_buckets', row => Date.parse(row.expires_at) <= now()).length;
      count.leases = prune('chat_concurrency_leases', row => Date.parse(row.expires_at) <= now()).length;
      count.outbox = prune('integration_outbox',row=>Date.parse(row.created_at)<cutoff(body.p_notification_days) && (row.status!=='sending'||Date.parse(row.lease_until)<=now())).length;
      count.chat_operations = prune('chat_turn_operations',row=>Date.parse(row.expires_at)<=now()).length;
      count.dashboard_operations = prune('dashboard_ai_operations',row=>Date.parse(row.created_at)<cutoff(30)).length;
      return count;
    }
    return undefined;
  }
  return { rpc };
}
