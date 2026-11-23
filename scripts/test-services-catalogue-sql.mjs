import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { loadChatFirstServices } from './chat-first-catalogue-fixture.mjs';

// Own NEW disposable loopback cluster only. No .env or connection argument.
// Tests the editorial INSERT/replay; does not claim deployed Supabase/RLS QA.
const temporary = await mkdtemp(path.join(tmpdir(),'akrasia-services-sql-'));
const data = path.join(temporary,'data');
const binaries = await import(`@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`);
const runtime = path.join(temporary,'runtime');
await cp(path.dirname(path.dirname(binaries.postgres)),runtime,{recursive:true});
const executable = name => path.join(runtime,'bin',name+(process.platform === 'win32' ? '.exe' : ''));
const reservation = createServer();
await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
const port = reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
const password = randomUUID();
let client, assertions = 0, started = false;
const equal = (actual,expected,label) => {assertions++;assert.deepEqual(actual,expected,label);};
async function command(name,args) {
  const child=spawn(executable(name),args,{cwd:temporary,windowsHide:true,env:{...process.env,PGPASSWORD:password,PGCLIENTENCODING:'UTF8'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',value=>{output+=value;});child.stderr.on('data',value=>{output+=value;});
  const background=name==='pg_ctl'&&args.includes('start');
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once(background?'exit':'close',resolve);});
  if(background){child.stdout.destroy();child.stderr.destroy();}
  if(code!==0)throw new Error(output.slice(-4000));
}
try {
  const passwordFile=path.join(temporary,'password');await writeFile(passwordFile,password,{mode:0o600});
  await command('initdb',['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile',passwordFile,'--locale=C','--encoding=UTF8']);
  await command('pg_ctl',['-D',data,'-l',path.join(temporary,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port}`,'start']);started=true;
  client=new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});await client.connect();
  const drafts=await loadChatFirstServices();
  const jsonFields=new Set(['features','features_en','process','process_en']);
  const fields=Object.keys(drafts[0]).map(field=>`${field} ${field==='id'?'uuid PRIMARY KEY':field==='slug'?'text UNIQUE NOT NULL':field==='highlighted'||field==='is_published'?'boolean':field==='sort_order'?'integer':jsonFields.has(field)?'jsonb':'text'}`);
  await client.query(`CREATE TABLE public.services(${fields.join(',')})`);
  await client.query("INSERT INTO public.services(id,slug,title,description,is_published) VALUES('00000000-0000-4000-8000-000000001111','direction','Título existente','Texto existente',true)");
  const sql=await readFile(new URL('../supabase/seeds/services-editorial.sql',import.meta.url),'utf8');
  const snapshot=async()=> (await client.query('SELECT * FROM public.services ORDER BY slug')).rows;
  await client.query(sql);
  let rows=await snapshot();equal(rows.length,6,'Exactly six slugs, existing original not duplicated');
  equal(rows.filter(row=>row.is_published).map(row=>row.slug),['direction'],'Only existing explicit approval remains');
  equal(rows.find(row=>row.slug==='direction').title,'Título existente','Existing editorial work preserved');
  equal(rows.find(row=>row.slug==='direction').description,'Texto existente','Existing description preserved');
  const before=await snapshot();await client.query(sql);equal(await snapshot(),before,'Identical snapshot after replay');
  await client.query("UPDATE public.services SET is_published=true WHERE slug='ai-generation'; UPDATE public.services SET title='Edición posterior',description='Trabajo editorial posterior' WHERE slug='content-creation'; UPDATE public.services SET is_published=false WHERE slug='direction'");
  const changed=await snapshot();await client.query(sql);equal(await snapshot(),changed,'Replay preserves subsequent approval, withdrawal and editing');
  rows=await snapshot();equal(rows.find(row=>row.slug==='direction').is_published,false,'Withdrawn service stays withdrawn');
  equal(rows.find(row=>row.slug==='ai-generation').is_published,true,'Later approval preserved');
  equal(rows.find(row=>row.slug==='content-creation').title,'Edición posterior','Later content changes preserved');
  for(const row of rows.filter(row=>row.slug!=='direction')) {
    equal(row.title_en.length>0,true,'English title imported');
    equal(row.hero_description_en.length>0,true,'English details imported');
    equal(Array.isArray(row.features)&&row.features.length===3,true,'Three concrete capabilities imported');
    equal(Array.isArray(row.process_en)&&row.process_en.length===3,true,'Three translated process steps imported');
  }
  console.log(`PASS editorial SQL: ${assertions} checks in actual disposable PostgreSQL; six drafts, preservation and replay. No existing database or remote service contacted.`);
} finally {
  await client?.end().catch(()=>{});
  if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','-t','15','stop']).catch(()=>{});
  const resolved=path.resolve(temporary);
  if(!resolved.startsWith(path.resolve(tmpdir())+path.sep+'akrasia-services-sql-'))throw new Error('Unexpected temporary directory');
  await rm(resolved,{recursive:true,force:true});
}
