import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,envFile:false,logLevel:'silent',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true}});
let checks=0;
try {
  const client=await vite.ssrLoadModule('/src/lib/chat-client.ts');
  const base={status:'confirmed',booking:{id:'00000000-0000-4000-8000-000000000001',date:'2030-01-07',time:'10:00',duration_min:30,meet_url:''},notification:'queued'};
  for(const url of ['', 'https://example.invalid/reviewed-meeting?room=studio']) for(const notification of ['queued','already_processed']) {
    const action={...base,booking:{...base.booking,meet_url:url},notification};
    assert.deepEqual(client.parseChatAction(action),action);checks++;
    const wire=`data: ${JSON.stringify({action})}\n\ndata: [DONE]\n\n`;
    for(let boundary=0;boundary<=wire.length;boundary++) {
      const parser=client.createChatSSEParser();const events=[...parser.push(wire.slice(0,boundary)),...parser.push(wire.slice(boundary))];
      assert.deepEqual(events,[{action},{done:true}]);assert.equal(parser.complete,true);checks+=2;
    }
  }
  for(const url of ['javascript:alert(1)','data:text/html,unsafe','http://example.invalid','https://user:password@example.invalid','https://example.invalid/#secret','/relative',null]) {
    assert.throws(()=>client.parseChatAction({...base,booking:{...base.booking,meet_url:url}}));checks++;
  }
  for(const notification of ['attempted','failed','sent','delivered',null]) {assert.throws(()=>client.parseChatAction({...base,notification}));checks++;}
  assert.throws(()=>client.parseChatAction({...base,booking:{...base.booking,duration_min:60}}));checks++;
  console.log(`PASS: ${checks} booking-result client assertions; fragmented SSE, honest queued status and safe optional meeting links.`);
} finally {await vite.close();}
