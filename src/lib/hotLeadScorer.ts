import {hasWholePhrase,positiveClauses} from './extractContactData';
export interface HotLeadResult {isHot:boolean;score:number;level:'cold'|'warm'|'hot';matchedKeywords:string[];budgetMentioned:string|null;declined:boolean}
const signals:Array<{key:string;weight:number;phrases:string[]}>= [
 {key:'request',weight:25,phrases:['necesitamos','necesito','queremos','buscamos','contratar','encargar','we need','we want','hire']},
 {key:'quote',weight:20,phrases:['presupuesto','precio','cuanto cuesta','budget','quote','cost']},
 {key:'project',weight:15,phrases:['proyecto','campaña','campana','project','campaign']},
 {key:'production',weight:15,phrases:['producir','rodar','grabar','produccion','produce','shoot']},
 {key:'deadline',weight:10,phrases:['plazo','fecha','deadline','timeline','estreno','lanzamiento','release']},
 {key:'urgent',weight:10,phrases:['urgente','urgent']}
];
export function scoreLead(text:string):HotLeadResult {
 const input=typeof text==='string'?text.slice(0,32000):'';
 if(/\b(?:no\s+(?:(?:queremos|necesitamos|vamos a|nos interesa)\s+)?(?:contratar|encargar|producir|el proyecto)|not interested|do not want|don't want)\b/i.test(input.split('\n').at(-1)||''))return {isHot:false,score:0,level:'cold',matchedKeywords:[],budgetMentioned:null,declined:true};
 const clauses=positiveClauses(input);const matched=signals.filter(signal=>signal.phrases.some(phrase=>clauses.some(clause=>hasWholePhrase(clause,phrase))));
 const amount=clauses.map(clause=>clause.match(/\b\d{1,7}(?:[.,]\d{1,2})?\s*(?:€|(?:euros?|eur|usd|dollars?)\b)/i)?.[0]||clause.match(/\b(?:presupuesto|budget)\s+(?:de\s+|of\s+)?\d{1,7}\b/i)?.[0]).find(Boolean)||null;
 const score=Math.min(100,matched.reduce((sum,item)=>sum+item.weight,0)+(amount?20:0));const level=score>=50?'hot':score>=20?'warm':'cold';
 return {isHot:level==='hot',score,level,matchedKeywords:matched.map(item=>item.key),budgetMentioned:amount,declined:false};
}
