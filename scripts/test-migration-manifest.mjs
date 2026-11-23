import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {removeOuterTransaction,splitSqlStatements,applyMigrationPlan,inspectMigrationJournal,previewMigrationAdoption} from './apply-migrations.mjs';
import {sqlDigest} from './migration-manifest.mjs';
export function verifyMigrationLexer(){
 let checks=0;const equal=(a,b)=>{checks++;assert.deepEqual(a,b);};
 const functionSql="CREATE FUNCTION public.journal_echo() RETURNS text LANGUAGE sql AS $body$ SELECT 'BEGIN; COMMIT; /* not a comment */'; $body$;";
 const input=`-- reviewed migration\n/* outer /* nested */ comment */ BEGIN;\n${functionSql}\nCOMMIT; -- tail`;
 const executable=removeOuterTransaction(input);assert.ok(executable.includes(functionSql));checks++;
 equal(splitSqlStatements(executable).filter(item=>item.includes('CREATE FUNCTION')).length,1);
 const quoted="SELECT E'escaped \\' quote; BEGIN;', 'doubled '' quote; END;', \"quoted;name\";";
 equal(splitSqlStatements(quoted).length,1);equal(removeOuterTransaction(quoted),quoted);
 for(const broken of ['BEGIN; SELECT 1;','SELECT 1; COMMIT;','BEGIN;SELECT 1;BEGIN;SELECT 2;COMMIT;',"SELECT 'unterminated",'SELECT $body$bad;','/* open']){assert.throws(()=>removeOuterTransaction(broken));checks++;}
 return checks;
}
const item=(version,sql)=>({version,name:`journal-test-${version}.sql`,sql,sha256:sqlDigest(sql)});
/** Called only by the disposable PostgreSQL runner, never discovers credentials. */
export async function verifyMigrationJournal({Client,connection}){
 if(!Client||!connection||!['127.0.0.1','localhost','::1'].includes(connection.host)||connection.database!=='akrasia_a05_integrated')throw new Error('Journal tests require the explicitly created loopback disposable database.');
 const admin=new Client(connection);await admin.connect();let client;
 let checks=verifyMigrationLexer();const ok=(value,message)=>{checks++;assert.ok(value,message);};const equal=(a,b,message)=>{checks++;assert.deepEqual(a,b,message);};
 try{
  const database='akrasia_a05_journal';
  // CREATE must fail if this name pre-exists. No existing database is dropped.
  await admin.query(`CREATE DATABASE ${database}`);
  client=new Client({...connection,database});await client.connect();
  const managedTables=['journal_fixture'];
  const plan=[item(1,"BEGIN; CREATE TABLE IF NOT EXISTS public.journal_fixture(id integer PRIMARY KEY,label text); INSERT INTO public.journal_fixture VALUES(1,'synthetic'); COMMIT;"),item(2,"/* nested /* synthetic */ header */ BEGIN; CREATE FUNCTION public.journal_echo() RETURNS text LANGUAGE sql AS $body$ SELECT 'BEGIN; COMMIT;'; $body$; COMMIT;")];
  const applied=await applyMigrationPlan(client,plan,{managedTables});equal(applied.applied,[1,2]);equal(applied.adopted,false);
  equal((await client.query('SELECT public.journal_echo() AS value')).rows[0].value,'BEGIN; COMMIT;');
  const skip=await applyMigrationPlan(client,plan,{managedTables});equal(skip.skipped,[1,2]);equal(skip.applied,[]);equal((await client.query('SELECT count(*)::int AS count FROM public.journal_fixture')).rows[0].count,1);
  const changed=[item(1,plan[0].sql+'\n-- changed applied source'),plan[1]];
  await assert.rejects(()=>applyMigrationPlan(client,changed,{managedTables}),/drift/);checks++;
  const broken=[...plan,item(3,'BEGIN; ALTER TABLE public.journal_fixture ADD COLUMN failed_column text; SELECT 1/0; COMMIT;')];
  await assert.rejects(()=>applyMigrationPlan(client,broken,{managedTables}),/rolled back/);checks++;
  equal((await client.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='journal_fixture' AND column_name='failed_column'")).rows[0].count,0);
  equal((await client.query('SELECT count(*)::int AS count FROM akrasia_migrations.journal')).rows[0].count,2);
  const complete=[...plan,item(3,'BEGIN; ALTER TABLE public.journal_fixture ADD COLUMN added_column text; COMMIT;')];
  equal((await applyMigrationPlan(client,complete,{managedTables})).applied,[3]);
  await client.query('ALTER TABLE public.journal_fixture ADD COLUMN unexpected_column text');
  await assert.rejects(()=>applyMigrationPlan(client,complete,{managedTables}),/catalog drift/);checks++;
  await client.query('ALTER TABLE public.journal_fixture DROP COLUMN unexpected_column');
  equal((await applyMigrationPlan(client,complete,{managedTables})).skipped,[1,2,3]);
  equal((await client.query("SELECT coalesce((SELECT bool_or(x.grantee=0 AND x.privilege_type='USAGE') FROM aclexplode(n.nspacl) x),false) AS allowed FROM pg_namespace n WHERE n.nspname='akrasia_migrations'")).rows[0].allowed,false);
  // Reset only the journal created above inside our newly created disposable DB.
  await client.query('DROP SCHEMA akrasia_migrations CASCADE');
  const adoption=[item(1,"BEGIN; CREATE TABLE public.adoption_fixture(id integer PRIMARY KEY,label text); ALTER TABLE public.adoption_fixture ENABLE ROW LEVEL SECURITY; CREATE POLICY journal_existing_policy ON public.adoption_fixture FOR SELECT USING(true); INSERT INTO public.adoption_fixture VALUES(1,'old record'); COMMIT;"),item(2,'BEGIN; ALTER TABLE public.adoption_fixture ADD COLUMN upgraded_column text; COMMIT;')];
  const adoptionTables=['adoption_fixture'];
  await client.query(removeOuterTransaction(adoption[0].sql));
  await assert.rejects(()=>applyMigrationPlan(client,adoption,{managedTables:adoptionTables}),/adoption/);checks++;
  ok(!(await inspectMigrationJournal(client,adoption,{managedTables:adoptionTables})).exists,'A refused adoption creates no journal.');
  await assert.rejects(()=>applyMigrationPlan(client,adoption,{managedTables:adoptionTables,adoptExisting:true}),/boolean/);checks++;
  const preview=await previewMigrationAdoption(client,adoption,{throughVersion:1,managedTables:adoptionTables});
  await assert.rejects(()=>applyMigrationPlan(client,adoption,{managedTables:adoptionTables,adoptExisting:{throughVersion:1,catalogSha256:'0'.repeat(64)}}),/fingerprint changed/);checks++;
  ok(!(await inspectMigrationJournal(client,adoption,{managedTables:adoptionTables})).exists,'A mismatched adoption creates no journal.');
  const adopted=await applyMigrationPlan(client,adoption,{managedTables:adoptionTables,adoptExisting:{throughVersion:preview.throughVersion,catalogSha256:preview.catalogSha256}});equal(adopted.adopted,true);equal(adopted.applied,[2]);equal(adopted.skipped,[1]);
  equal((await client.query('SELECT version,adopted FROM akrasia_migrations.journal ORDER BY version')).rows,[{version:1,adopted:true},{version:2,adopted:false}]);
  equal((await client.query('SELECT count(*)::int AS count FROM public.adoption_fixture')).rows[0].count,1);
  equal((await client.query("SELECT count(*)::int AS count FROM pg_policies WHERE tablename='adoption_fixture' AND policyname='journal_existing_policy'")).rows[0].count,1);
  equal((await applyMigrationPlan(client,adoption,{managedTables:adoptionTables})).skipped,[1,2]);
  console.log(`PASS journal/lexer: ${checks} real/offline assertions; owned disposable database only.`);return checks;
 }finally{await client?.end().catch(()=>{});await admin.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log(`PASS migration lexer: ${verifyMigrationLexer()} assertions; no database connection.`);}
