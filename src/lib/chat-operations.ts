import {createHmac} from 'node:crypto';
import {ChatFailure,type ChatConfig} from './chat-security';
import {lifecycleRpc} from './chat-lifecycle';
import {isVisitorUuid} from './visitor-data';
import type {BookingActionResult} from './chat-actions';
export interface ChatOperationInput {visitorId:string;expiresAt:number;contextVersion:number;operationId:string;requestHash:string;config:ChatConfig;signal:AbortSignal}
export type ChatOperationResult={status:'claimed'}|{status:'complete';response:string;action?:BookingActionResult};
export interface ChatOperationStore {claim(input:ChatOperationInput):Promise<ChatOperationResult>}
export function chatRequestHash(config:ChatConfig,text:string,language:'es'|'en'):string {
 return createHmac('sha256',Buffer.from(config.secret,'hex')).update('akrasia-chat-turn-v1:').update(JSON.stringify([text,language])).digest('hex');
}
export const chatOperationStore:ChatOperationStore={async claim(input){
 if(!isVisitorUuid(input.operationId)||!/^[a-f0-9]{64}$/.test(input.requestHash))throw new ChatFailure('invalid_request',400);
 const value=await lifecycleRpc(input.config,'chat_claim_turn',{p_visitor_id:input.visitorId,p_expires_at:input.expiresAt,p_context_version:input.contextVersion,
   p_operation_id:input.operationId,p_request_hash:input.requestHash},input.signal) as Record<string,unknown>;
 if(value?.error==='invalid_request')throw new ChatFailure('invalid_request',400);
 if(value?.status==='claimed')return {status:'claimed'};
 if(value?.status==='complete'&&typeof value.response==='string'&&value.response.trim()&&Buffer.byteLength(value.response,'utf8')<=16000){
   if(value.action!==null&&value.action!==undefined&&(typeof value.action!=='object'||Array.isArray(value.action)))throw new ChatFailure('chat_unavailable',503);
   return {status:'complete',response:value.response,...(value.action?{action:value.action as BookingActionResult}:{})};
 }
 throw new ChatFailure('chat_unavailable',503);
}};
