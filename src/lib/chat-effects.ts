import {extractContactData} from './extractContactData';
import {scoreLead} from './hotLeadScorer';
import {ChatFailure,readChatConfig} from './chat-security';
import {chatLifecycleStore,lifecycleRpc,requireContextVersion,isContextVersion} from './chat-lifecycle';
import {chatRequestHash} from './chat-operations';
import {isVisitorUuid} from './visitor-data';
import type {ChatEffectsInput} from './chat-handler';
export type {ChatEffectsInput} from './chat-handler';
/** A server-owned turn/profile/outbox commit; no provider or detached effects. */
export async function saveChatEffects(input:ChatEffectsInput):Promise<void> {
 const {visitorId,messages,response,signal}=input;signal.throwIfAborted();
 const config=input.config||readChatConfig(import.meta.env,import.meta.env.PROD,false);const expiresAt=input.sessionExpiresAt??Math.floor(Date.now()/1000)+config.sessionSeconds;
 const version=input.contextVersion??0;const language=input.language||'es';
 const assertAlive=()=>{signal.throwIfAborted();if(input.deadlineAt!==undefined&&performance.now()>=input.deadlineAt)throw new ChatFailure('chat_timeout',504,5);};
 if(!isContextVersion(version))throw new ChatFailure('invalid_request',400);
 await requireContextVersion(config,visitorId,expiresAt,version,signal,chatLifecycleStore);
 const last=messages.filter(message=>message.role==='user').pop();if(!last||!response.trim()||!isVisitorUuid(input.operationId))throw new ChatFailure('invalid_request',400);
 const previous=(input.history||[]).filter(message=>message.role==='assistant').at(-1)?.content||'';
 const extracted=extractContactData(last.content,previous);
 const score=scoreLead([...(input.history||[]).filter(message=>message.role==='user').slice(-4).map(message=>message.content),last.content].join('\n'));
 const lead=extracted.emails.length||extracted.phones.length||extracted.name||extracted.company||extracted.projectType||score.score>0||score.declined?{
   email:extracted.emails[0]||null,phone:extracted.phones[0]||null,name:extracted.name,company:extracted.company,project_type:extracted.projectType,
   budget_mentioned:score.budgetMentioned,interest_score:score.score,interest_level:score.level}:null;
 assertAlive();
 const saved=await lifecycleRpc(config,'chat_save_turn',{p_visitor_id:visitorId,p_expires_at:expiresAt,p_context_version:version,
   p_operation_id:input.operationId,p_request_hash:chatRequestHash(config,last.content,language),p_user_content:last.content,p_assistant_content:response,p_lead:lead,p_action:input.action||null},signal);
 if(!saved||typeof saved!=='object'||(saved as Record<string,unknown>).saved!==true||(saved as Record<string,unknown>).contextVersion!==version)throw new ChatFailure('chat_unavailable',503);
 assertAlive();
}
