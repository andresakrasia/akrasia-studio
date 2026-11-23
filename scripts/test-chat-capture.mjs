import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createServer} from 'vite';
import {createVisitorIsolationFixture} from './visitor-isolation-test-fixture.mjs';import {installFetchGuard} from './dashboard-test-network-guard.mjs';
const fixture=await createVisitorIsolationFixture();const guard=installFetchGuard([fixture.origin]);const env=fixture.environment();
const vite=await createServer({root:process.cwd(),configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},
 define:Object.fromEntries(Object.entries({...env,PROD:false,DEV:true,SSR:true}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
let checks=0,groups=0;const eq=(a,b)=>{checks++;assert.deepEqual(a,b);};const ok=v=>{checks++;assert.ok(v);};const group=async(name,run)=>{fixture.reset();await run();console.log(`ok ${++groups} - ${name}`);};
try{
 const security=await vite.ssrLoadModule('/src/lib/chat-security.ts'),handlers=await vite.ssrLoadModule('/src/lib/chat-handler.ts'),effects=await vite.ssrLoadModule('/src/lib/chat-effects.ts'),capture=await vite.ssrLoadModule('/src/lib/extractContactData.ts'),score=await vite.ssrLoadModule('/src/lib/hotLeadScorer.ts'),client=await vite.ssrLoadModule('/src/lib/chat-client.ts'),life=await vite.ssrLoadModule('/src/lib/chat-lifecycle.ts');
 const config=security.readChatConfig(env);const session=()=>{const value=security.chatSession(new Request(env.CHAT_ORIGIN),config,fixture.state.now);return {...value,cookie:value.cookie.split(';')[0]};};
 function setup(options={}){const calls={provider:0,effects:0,admissions:0};const handle=handlers.createChatHandler({config:()=>({...config,...options.config}),now:()=>fixture.state.now,
   provider:async input=>{calls.provider++;return options.provider?options.provider(input):(async function*(){yield 'Respuesta del servidor.';})();},
   effects:async input=>{calls.effects++;await effects.saveChatEffects(input);if(options.afterSave)await options.afterSave(input);},
   store:{admit:async()=>{calls.admissions++;return {allowed:true,reason:null,retryAfter:0};},release:async()=>{}}});
   return {calls,send:(current,text,operationId=randomUUID(),extra={})=>handle({request:new Request(`${env.CHAT_ORIGIN}/api/chat`,{method:'POST',headers:{origin:env.CHAT_ORIGIN,cookie:current.cookie,'content-type':'application/json'},
     body:JSON.stringify({messages:[{role:'user',content:text}],context_version:0,operation_id:operationId,language:'es',...extra})})})};}
 async function complete(response){eq(response.status,200);const text=await response.text();ok(text.includes('[DONE]'));return text;}
 await group('Names and companies are distinct; project keywords use complete positive phrases',async()=>{
   eq(capture.extractContactData('Me llamo Ana Pérez.').name,'Ana Pérez');eq(capture.extractContactData('Mi empresa es Synthetic Studio.').company,'Synthetic Studio');eq(capture.extractContactData('Mi empresa es Synthetic Studio.').name,null);
   eq(capture.extractContactData('Ana Pérez','¿Cómo te llamas?').name,'Ana Pérez');eq(capture.extractContactData('Synthetic Studio','¿Cuál es el nombre de tu empresa?').company,'Synthetic Studio');
   eq(capture.extractContactData('Ana Pérez').name,null);eq(capture.extractContactData('Cada día trabajamos con marcas').projectType,null);eq(capture.extractContactData('No queremos un spot, pero necesitamos branded content').projectType,'branded');
   eq(capture.extractContactData('Queremos un spot publicitario').projectType,'spot');eq(capture.extractContactData('Un spot y un documental').projectType,null);
   eq(capture.extractContactData('Nombre: la empresa Synthetic').name,null);eq(capture.extractContactData('Mi email es a@example.invalid y teléfono +34 612 345 678').phones,['+34612345678']);
   for(const text of ['No queremos contratar','not interested in a project','no presupuesto ni campaña']){eq(score.scoreLead(text).isHot,false);eq(score.scoreLead(text).score,0);}
   eq(score.scoreLead('estreno estreno').score,10);eq(score.scoreLead('despresupuesto preproyecto').score,0);eq(score.scoreLead('Necesitamos producir un proyecto, presupuesto 5000 € para un estreno').level,'hot');
   eq(score.scoreLead('Necesitamos producir un proyecto\nNo queremos contratar').score,0);ok(score.scoreLead('No queremos contratar\nNecesitamos producir un proyecto').score>0);
 });
 await group('Predefined ES/EN answers commit a server conversation without invoking AI',async()=>{
   const current=session(),test=setup({config:{apiKey:''},provider:()=>assert.fail('No AI for CTA')});
   await complete(await test.send(current,'Hola, quiero saber más sobre Akrasia Studio'));eq(test.calls.provider,0);eq(fixture.tables.messages.length,2);
   const english=await complete(await test.send(current,'I want to start a project with you',randomUUID(),{language:'en'}));ok(english.includes('Tell us'));eq(test.calls.provider,0);eq(fixture.tables.messages.length,4);eq(fixture.tables.conversations.length,1);
   ok(!JSON.stringify(fixture.tables.messages).includes('Hollywood'));eq((await test.send(current,'Consulta que requiere IA')).status,503);eq(test.calls.provider,0);
 });
 await group('Profile fields accumulate across single-field messages and preserve commercial status',async()=>{
   const current=session(),test=setup({provider:async()=> (async function*(){yield '¿Cómo te llamas?';})()});
   await complete(await test.send(current,'Mi email es synthetic@example.invalid'));eq(fixture.tables.leads.length,1);const lead=fixture.tables.leads[0];lead.status='contacted';
   await complete(await test.send(current,'Ana Pérez'));eq(lead.name,'Ana Pérez');eq(lead.email,'synthetic@example.invalid');
   await complete(await test.send(current,'Mi empresa es Synthetic Studio'));eq(lead.company,'Synthetic Studio');eq(lead.name,'Ana Pérez');eq(lead.status,'contacted');
   await complete(await test.send(current,'Necesitamos un spot con presupuesto 5000 euros para un estreno'));eq(lead.project_type,'spot');eq(lead.interest_level,'hot');eq(lead.status,'contacted');
   await complete(await test.send(current,'No queremos contratar'));eq(lead.interest_level,'cold');eq(lead.status,'contacted');eq(fixture.tables.leads.length,1);
   ok(fixture.tables.integration_outbox.every(row=>!JSON.stringify(row.payload).includes('synthetic@example.invalid')&&!JSON.stringify(row.payload).includes('Ana Pérez')));
 });
 await group('Completed response replay has no second AI, message, contact or notification',async()=>{
   const current=session(),other=session(),test=setup(),operationId=randomUUID();
   const first=await complete(await test.send(current,'Mi email es synthetic@example.invalid',operationId));const second=await complete(await test.send(current,'Mi email es synthetic@example.invalid',operationId));
   eq(test.calls.provider,1);eq(test.calls.effects,1);eq(fixture.tables.messages.length,2);eq(fixture.tables.leads.length,1);eq(fixture.tables.integration_outbox.length,1);eq(first,second);
   eq((await test.send(current,'Changed message',operationId)).status,400);eq((await test.send(other,'Mi email es synthetic@example.invalid',operationId)).status,400);eq(test.calls.provider,1);
 });
 await group('Ambiguous response after commit recovers without duplicate provider/business effects',async()=>{
   const current=session(),test=setup({afterSave:()=>{throw new Error('Synthetic response lost after database commit');}}),operationId=randomUUID();
   const failed=await test.send(current,'Mi teléfono es 612345678',operationId);const text=await failed.text();ok(text.includes('"error"'));ok(!text.includes('[DONE]'));eq(fixture.tables.messages.length,2);
   await complete(await test.send(current,'Mi teléfono es 612345678',operationId));eq(test.calls.provider,1);eq(test.calls.effects,1);eq(fixture.tables.integration_outbox.length,1);
 });
 await group('Pending identical operations serialize; rejected malformed contracts have no quota/store effects',async()=>{
   const current=session(),operationId=randomUUID();let resolve;const gate=new Promise(done=>{resolve=done;});const test=setup({provider:async()=> (async function*(){yield 'Prefix';await gate;yield ' Complete';})()});
   const first=await test.send(current,'Consulta activa',operationId);eq((await test.send(current,'Consulta activa',operationId)).status,409);eq(test.calls.provider,1);resolve();await complete(first);eq(fixture.tables.messages.length,2);
   for(const extra of [{operation_id:null},{operation_id:'legacy-id'},{language:'fr'},{language:{}},{language:null}]){const before=fixture.requests.length,admissions=test.calls.admissions;eq((await test.send(current,'Invalid contract',randomUUID(),extra)).status,400);eq(fixture.requests.length,before);eq(test.calls.admissions,admissions);}
 });
 await group('A09 erasure invalidates receipts/action context and never restores private messages',async()=>{
   const current=session(),test=setup(),operationId=randomUUID();await complete(await test.send(current,'Me llamo Ana Ficticia',operationId));
   const state=await life.chatLifecycleStore.erase(config,current.id,current.expiresAt,0,new AbortController().signal);eq(state.contextVersion,1);eq(fixture.tables.messages.length,0);
   eq((await test.send(current,'Me llamo Ana Ficticia',operationId)).status,409);eq(test.calls.provider,1);ok(!fixture.tables.chat_turn_operations.some(row=>row.status==='complete'));
 });
 await group('SSE buffering accepts every UTF-8/JSON boundary and requires a terminal event',async()=>{
   const source=`data: ${JSON.stringify({content:'Película € — niño 👋'})}\n\ndata: [DONE]\n\n`;const bytes=new TextEncoder().encode(source);
   for(let split=1;split<bytes.length;split++){const decoder=new TextDecoder(),parser=client.createChatSSEParser();const events=[...parser.push(decoder.decode(bytes.slice(0,split),{stream:true})),...parser.push(decoder.decode(bytes.slice(split),{stream:true})),...parser.push(decoder.decode())];parser.finish();eq(events.filter(e=>'content'in e).map(e=>e.content).join(''),'Película € — niño 👋');}
   const incomplete=client.createChatSSEParser();incomplete.push('data: {"content":"partial"}\n\n');checks++;assert.throws(()=>incomplete.finish());
 });
 eq(guard.blocked,[]);console.log(`Chat capture/operations: ${groups} groups / ${checks} checks passed; no paid AI or external effects.`);
}finally{guard.restore();await vite.close();await fixture.close();}
