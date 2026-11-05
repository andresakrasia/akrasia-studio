import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readMigrationPlan,sqlDigest} from './migration-manifest.mjs';
const JOURNAL='akrasia_migrations';
export const MANAGED_TABLES=['visitors','conversations','messages','leads','content','projects','project_tasks','feed_entries','studio_logs','studio_stats','services','clients','bookings','availability','availability_overrides','sent_emails','integration_outbox','chat_turn_operations','dashboard_sessions','dashboard_login_limits','chat_quota_buckets','chat_concurrency_leases','chat_context_states','dashboard_ai_operations','client_journeys','client_journey_events','email_drafts','client_journey_operations'];
// Lexer tracks quotes, dollar bodies and nested comments. It never applies
// transaction keywords inside a function body/string/comment as outer wrappers.
export function splitSqlStatements(sql) {
 const parts=[];let start=0,state='normal',tag='',depth=0,eString=false;
 for(let i=0;i<sql.length;i++){
  const ch=sql[i],next=sql[i+1];
  if(state==='line'){if(ch==='\n')state='normal';continue;}
  if(state==='block'){if(ch==='/'&&next==='*'){depth++;i++;}else if(ch==='*'&&next==='/'){depth--;i++;if(!depth)state='normal';}continue;}
  if(state==='dollar'){if(sql.startsWith(tag,i)){i+=tag.length-1;state='normal';}continue;}
  if(state==='single'){if(eString&&ch==='\\'){i++;continue;}if(ch==="'"&&next==="'"){i++;continue;}if(ch==="'")state='normal';continue;}
  if(state==='double'){if(ch==='"'&&next==='"'){i++;continue;}if(ch==='"')state='normal';continue;}
  if(ch==='-'&&next==='-'){state='line';i++;continue;}
  if(ch==='/'&&next==='*'){state='block';depth=1;i++;continue;}
  if(ch==="'"){state='single';eString=sql[i-1]?.toLowerCase()==='e'&&!/[a-z0-9_]/i.test(sql[i-2]||'');continue;}
  if(ch==='"'){state='double';continue;}
  if(ch==='$'){const match=/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(i));if(match){tag=match[0];state='dollar';i+=tag.length-1;continue;}}
  if(ch===';'){parts.push(sql.slice(start,i+1));start=i+1;}
 }
 if(!['normal','line'].includes(state))throw new Error('Unterminated SQL string/body/comment.');
 if(sql.slice(start).trim())parts.push(sql.slice(start));return parts;
}
function codeOnly(statement){
 let result='';let quote='',tag='';
 for(let i=0;i<statement.length;i++){
  const ch=statement[i],next=statement[i+1];
  if(tag){result+=ch;if(statement.startsWith(tag,i)){result+=statement.slice(i+1,i+tag.length);i+=tag.length-1;tag='';}continue;}
  if(quote){result+=ch;if(ch===quote&&next===quote){result+=next;i++;}else if(ch===quote)quote='';continue;}
  if(ch==='-'&&next==='-'){while(i<statement.length&&statement[i]!=='\n')i++;result+=' ';continue;}
  if(ch==='/'&&next==='*'){let depth=1;i+=2;while(i<statement.length&&depth){if(statement[i]==='/'&&statement[i+1]==='*'){depth++;i+=2;}else if(statement[i]==='*'&&statement[i+1]==='/'){depth--;i+=2;}else i++;}i--;result+=' ';continue;}
  if(ch==="'"||ch==='"'){quote=ch;result+=ch;continue;}
  if(ch==='$'){const match=/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(statement.slice(i));if(match){tag=match[0];result+=tag;i+=tag.length-1;continue;}}
  result+=ch;
 }
 return result.replace(/^\uFEFF/,'').replace(/;\s*$/,'').trim();
}
export function removeOuterTransaction(sql) {
 const statements=splitSqlStatements(sql);const relevant=statements.map((text,index)=>({text,index,code:codeOnly(text)})).filter(part=>part.code&&!part.code.startsWith('--'));
 if(!relevant.length)throw new Error('Empty migration.');
 const begin=/^(?:BEGIN|START TRANSACTION)$/i.test(relevant[0].code),commit=/^(?:COMMIT|END)$/i.test(relevant.at(-1).code);
 if(begin!==commit)throw new Error('Migration has an incomplete outer transaction wrapper.');
 const indexes=begin?new Set([relevant[0].index,relevant.at(-1).index]):new Set();
 const kept=statements.filter((_,index)=>!indexes.has(index));
 if(kept.some(text=>/^(?:BEGIN|START TRANSACTION|COMMIT|ROLLBACK|END)$/i.test(codeOnly(text))))throw new Error('Migration contains a nested top-level transaction.');
 return kept.join('');
}
function validatePlan(plan) {
 if(!Array.isArray(plan)||!plan.length)throw new Error('Empty migration plan.');
 for(const [index,item] of plan.entries())if(item.version!==index+1||typeof item.sql!=='string'||typeof item.name!=='string'||!/^[a-z0-9-]+\.sql$/i.test(item.name)||item.sha256!==sqlDigest(item.sql))throw new Error('Migration plan checksum/order invalid.');
 return plan.map(item=>({...item,executable:removeOuterTransaction(item.sql)}));
}
export async function catalogFingerprint(client,plan,managedTables=MANAGED_TABLES){
 const functions=[...new Set(plan.flatMap(item=>[...item.sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)/ig)].map(match=>match[1].toLowerCase())))];
 const result=await client.query(`SELECT jsonb_build_object(
 'tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text) ORDER BY c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) ORDER BY c.relname,a.attnum),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid)) ORDER BY c.relname,x.conname),'[]'::jsonb) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname),'[]'::jsonb) FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[])),
 'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) ORDER BY tablename,policyname),'[]'::jsonb) FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY c.relname,t.tgname),'[]'::jsonb) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname=ANY($1::text[])),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($2::text[]))
 ) AS snapshot`,[managedTables,functions]);
 return sqlDigest(JSON.stringify(result.rows[0].snapshot));
}
export async function inspectMigrationJournal(client,plan,{managedTables=MANAGED_TABLES}={}) {
 const exists=(await client.query("SELECT to_regclass('akrasia_migrations.journal') IS NOT NULL AS present")).rows[0].present;
 const existing=(await client.query('SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[])',['public',managedTables])).rows.map(row=>row.relname);
 const rows=exists?(await client.query('SELECT version,name,sha256,catalog_sha256,applied_at,adopted FROM akrasia_migrations.journal ORDER BY version')).rows:[];
 for(const applied of rows){const source=plan.find(item=>item.version===applied.version);if(!source||source.name!==applied.name||source.sha256!==applied.sha256.trim())throw new Error(`Applied migration drift detected at version ${applied.version}; automatic changes stopped.`);}
 if(rows.some((row,index)=>row.version!==index+1))throw new Error('Migration journal has a gap.');
 if(rows.length&&rows.at(-1).catalog_sha256?.trim()!==await catalogFingerprint(client,plan.slice(0,rows.length),managedTables))throw new Error('Managed database catalog drift detected; automatic changes stopped.');
 return {exists,rows,existing,pending:plan.filter(item=>!rows.some(row=>row.version===item.version))};
}
function adoptionVersion(adoption,plan){
 if(!adoption||typeof adoption!=='object'||Array.isArray(adoption)||Object.keys(adoption).some(key=>!['throughVersion','catalogSha256'].includes(key))||!Number.isInteger(adoption.throughVersion)||adoption.throughVersion<1||adoption.throughVersion>plan.length||typeof adoption.catalogSha256!=='string'||!/^[a-f0-9]{64}$/.test(adoption.catalogSha256))throw new Error('Explicit adoption requires a reviewed {throughVersion,catalogSha256}; a boolean cannot adopt an existing database.');
 return adoption.throughVersion;
}
/** Read-only preview for a human-reviewed prefix; it does not infer applied history. */
export async function previewMigrationAdoption(client,plan,{throughVersion,managedTables=MANAGED_TABLES}={}){
 const validated=validatePlan(plan);
 if(!Number.isInteger(throughVersion)||throughVersion<1||throughVersion>validated.length)throw new Error('A reviewed prefix version is required.');
 return {throughVersion,catalogSha256:await catalogFingerprint(client,validated.slice(0,throughVersion),managedTables),migrations:validated.slice(0,throughVersion).map(({version,name,sha256})=>({version,name,sha256}))};
}
export async function applyMigrationPlan(client,plan,{adoptExisting=null,managedTables=MANAGED_TABLES}={}) {
 // Only a caller-supplied dedicated connected pg.Client is used. No .env/DSN,
 // cloud service discovery, automatic deployment, or production connection.
 const validated=validatePlan(plan);const throughVersion=adoptExisting==null?0:adoptionVersion(adoptExisting,validated);await client.query('SELECT pg_advisory_lock($1,$2)',[1095453515,1296648018]);
 try {
  const status=await inspectMigrationJournal(client,validated,{managedTables});
  if(throughVersion&&(!status.existing.length||status.rows.length))throw new Error('Adoption is allowed only for an existing managed schema without recorded history.');
  if(status.existing.length&&!status.rows.length&&!throughVersion)throw new Error('Existing managed schema has no migration journal. Explicit reviewed adoption is required.');
  const roles=(await client.query("SELECT rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role')")).rows.map(row=>row.rolname);
  const deny=['PUBLIC',...roles].join(',');
  const setup=()=>client.query(`CREATE SCHEMA IF NOT EXISTS ${JOURNAL}; REVOKE ALL ON SCHEMA ${JOURNAL} FROM ${deny}; CREATE TABLE IF NOT EXISTS ${JOURNAL}.journal(version integer PRIMARY KEY,name text UNIQUE NOT NULL,sha256 char(64) NOT NULL,catalog_sha256 char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),adopted boolean NOT NULL DEFAULT false); REVOKE ALL ON ALL TABLES IN SCHEMA ${JOURNAL} FROM ${deny};`);
  if(throughVersion){
   // Capture the reviewed current catalog before any DDL. Adoption records an
   // acknowledged prefix; it never replays its policies, INSERTs or privileges.
   const catalog=await catalogFingerprint(client,validated.slice(0,throughVersion),managedTables);
   if(catalog!==adoptExisting.catalogSha256)throw new Error('Adoption catalog fingerprint changed after review; no journal or migration was written.');
   await client.query('BEGIN');
   try{
    await setup();
    for(const migration of validated.slice(0,throughVersion))await client.query(`INSERT INTO ${JOURNAL}.journal(version,name,sha256,catalog_sha256,adopted) VALUES($1,$2,$3,$4,true)`,[migration.version,migration.name,migration.sha256,catalog]);
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw new Error('Adoption journal transaction was rolled back.',{cause:error});}
  }
  const pending=throughVersion?validated.slice(throughVersion):status.pending;
  const skipped=throughVersion?validated.slice(0,throughVersion).map(item=>item.version):status.rows.map(row=>row.version);
  for(const migration of pending){
   await client.query('BEGIN');
   try{
    await setup();
    await client.query(migration.executable);
    const catalog=await catalogFingerprint(client,validated.slice(0,migration.version),managedTables);
    await client.query(`INSERT INTO ${JOURNAL}.journal(version,name,sha256,catalog_sha256,adopted) VALUES($1,$2,$3,$4,false)`,[migration.version,migration.name,migration.sha256,catalog]);
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw new Error(`Migration ${migration.version} (${migration.name}) failed; that file and its journal entry were rolled back.`,{cause:error});}
  }
  return {applied:pending.map(item=>item.version),skipped,adopted:throughVersion>0};
 }finally{await client.query('SELECT pg_advisory_unlock($1,$2)',[1095453515,1296648018]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--apply')||process.argv.includes('--adopt'))throw new Error('This CLI checks offline only. Applying/adopting requires an explicitly authorized, caller-supplied PostgreSQL client and a reviewed target.');
 const plan=await readMigrationPlan();validatePlan(plan);console.log(`Offline check OK: ${plan.length} ordered files, matching SHA256 and valid outer transactions. No database connected.`);
}
