import { readFile,writeFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const manifestPath=path.join(projectRoot,'supabase/migration-manifest.json');
export const migrationNames=Array.from({length:25},(_,index)=>index===0?'migration.sql':`migration-v${index+1}.sql`);
export const sqlDigest=sql=>createHash('sha256').update(sql).digest('hex');
export async function generateMigrationManifest() {
 const migrations=[];
 for(const [index,name] of migrationNames.entries()) {
  const bytes=await readFile(path.join(projectRoot,'supabase',name));
  migrations.push({version:index+1,name,sha256:sqlDigest(bytes)});
 }
 const manifest={format:1,scope:'akrasia schema only; optional demo seeds excluded',migrations};
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export async function readMigrationPlan() {
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 if(manifest.format!==1||!Array.isArray(manifest.migrations)||manifest.migrations.length!==migrationNames.length)throw new Error('Migration manifest format/count mismatch.');
 const plan=[];
 for(const [index,item] of manifest.migrations.entries()){
  if(item.version!==index+1||item.name!==migrationNames[index]||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Migration manifest order/name invalid.');
  const bytes=await readFile(path.join(projectRoot,'supabase',item.name));
  if(sqlDigest(bytes)!==item.sha256)throw new Error(`Migration checksum mismatch: ${item.name}. Review the edit before refreshing the manifest.`);
  plan.push({...item,sql:bytes.toString('utf8')});
 }
 return plan;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--refresh')){await generateMigrationManifest();console.log('Migration manifest refreshed after explicit local review.');}
 else {const plan=await readMigrationPlan();console.log(`Manifest OK: ${plan.length} ordered migrations; no database connection or seed execution.`);}
}
