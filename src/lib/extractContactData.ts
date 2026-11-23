export interface ExtractedData { emails:string[]; phones:string[]; projectType:string|null; name:string|null; company:string|null }
const normalize=(text:string)=>text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export function hasWholePhrase(text:string,phrase:string):boolean {
  const escaped=normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`,'u').test(normalize(text));
}
export function positiveClauses(text:string):string[] {
  return normalize(text).split(/[.!?;\n]|\b(?:pero|sino|but|however)\b/).filter(part=>!/(?:^|\s)(?:no|not|never|sin|ni|without|don't|do not|dont)\b/.test(part));
}
const types:Record<string,string[]>={spot:['spot','publicidad','anuncio','advert','advertisement'],videoclip:['videoclip','video musical','music video'],branded:['branded','branded content','contenido de marca'],fashion:['fashion','moda','fashion film'],corto:['corto','cortometraje','short film'],documental:['documental','documentary','reportaje'],instalacion:['instalacion','inmersiva','exposicion','museum'],corporativo:['corporativo','corporate video','imagen de marca']};
function explicitField(text:string,kind:'name'|'company'):string|null {
  const pattern=kind==='name'?/(?:\bme llamo|\bmi nombre es|\bmy name is|\bnombre\s*:|\bname\s*:)\s*([^,;.!?\n]+)/iu:
    /(?:\b(?:mi|nuestra|la)\s+(?:empresa|marca|agencia|productora)\s+(?:es|se llama)|\b(?:empresa|company)\s*:|\b(?:my|our) company is|\brepresento a|\btrabajo en|\bi work (?:at|for))\s*([^,;!?\n]+)/iu;
  const raw=text.match(pattern)?.[1]?.split(/\s+(?:y|and|para|for|con|with|trabajo|quiero|necesito)\s+/iu)[0]?.trim().replace(/\.+$/,'');
  if (!raw || raw.length>150 || raw.length<2 || !/^[\p{L}\p{N} .&'’\-]+$/u.test(raw)) return null;
  if(kind==='name' && (raw.split(/\s+/).length>4 || /(?:^|\s)(?:empresa|marca|agencia|productora|company|agency|un|una|el|la|a|an|the|somos|estudio|studio)\b/i.test(raw)))return null;
  return raw;
}
export function extractContactData(text:string,previousAssistant=''):ExtractedData {
  const input=typeof text==='string'?text.slice(0,8000):'';
  const emails=[...new Set(input.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g)||[])].filter(value=>value.length<=254);
  const phones=[...new Set((input.match(/(?<![\p{L}\p{N}])(?:(?:\+34|0034)[ .\-]?)?(?:[679][0-9]{2})(?:[ .\-]?[0-9]{3}){2}(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])\+[1-9][0-9 .\-]{7,18}[0-9](?![\p{L}\p{N}])/gu)||[]).map(value=>value.replace(/[ .\-]/g,'')))].filter(value=>value.replace(/^\+/, '').length<=15);
  const clauses=positiveClauses(input);const candidates=Object.entries(types).filter(([,phrases])=>phrases.some(phrase=>clauses.some(clause=>hasWholePhrase(clause,phrase))));
  let name=explicitField(input,'name');let company=explicitField(input,'company');
  const bare=input.trim();
  if(!name && /(?:como te llamas|cual es tu nombre|what is your name|your name\?)/i.test(normalize(previousAssistant)) && /^[\p{L}][\p{L}'’\-]*(?:\s+[\p{L}][\p{L}'’\-]*){0,3}$/u.test(bare) && bare.length<=60 && !/^(?:no|si|hola|gracias|yes|thanks)$/i.test(bare))name=bare;
  if(!company && /(?:nombre de (?:tu|la) (?:empresa|marca)|que (?:empresa|marca)|company name)/i.test(normalize(previousAssistant)) && bare.length>=2 && bare.length<=100 && /^[\p{L}\p{N} .&'’\-]+$/u.test(bare))company=bare;
  return {emails,phones,projectType:candidates.length===1?candidates[0][0]:null,name,company};
}
