import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Production verification requires Node 24');
// Sequential because several suites compile SSR or use shared preview ports.
const suites = ['check-secrets','migration-manifest','check-isolated',
  'test-dashboard-auth','test-dashboard-theme','test-meeting-guide','test-meeting-intent','test-booking-calendar','test-email-templates','test-integration-worker-schedule','test-chat-limits','test-chat-contract','test-chat-provider-contract','test-chat-actions',
  'test-visitor-isolation','test-booking-isolation','test-safe-rendering','test-supabase-security',
  'test-project-publication','test-projects-sql','test-privacy-consent','test-analytics','test-chat-lifecycle',
  'test-project-upload','test-project-upload-http','test-project-media','test-csv-export','test-storage-sql',
  'test-agenda-integrations','test-booking-admin-email','test-booking-notification-status','test-admin-booking-agenda','test-dashboard-availability','test-availability-display','test-panel-data','test-client-journey','test-lead-conversation-context','test-email-writing','test-production-ai-context','test-public-web','test-chat-navigation','test-predefined-chat','test-public-activity','test-hud-activity','test-production-config',
  'test-chat-capture','test-chat-client-actions','test-chat-project-cards','test-chat-first-live-provider','test-chat-preview-clock','test-chat-preview-dashboard','test-chat-preview-agenda','test-preview-agenda-persistence','test-preview-bookings-persistence','test-preview-production-ai-fixture','test-services-catalogue','test-services-catalogue-sql','test-postgres','build-isolated'];
const results = [];
const startedAt = new Date().toISOString();
const evidenceDirectory = path.join(root,'docs/evidence');
await mkdir(evidenceDirectory,{recursive:true});
async function record(status, activeSuite = null) {
  await writeFile(path.join(evidenceDirectory,'production-local.json'),JSON.stringify({
    node:process.versions.node, startedAt, status, activeSuite, expectedSuites:suites.length,
    scope:'Local synthetic tests and actual disposable PostgreSQL. No deployment or real integrations.',results,
  },null,2));
}
await record('running');
for (const name of suites) {
  console.log(`\nRunning ${name}`);
  const start = Date.now();
  await record('running',name);
  const child = spawn(process.execPath,[`scripts/${name}.mjs`],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1',ASTRO_DEV_BACKGROUND:'0'}});
  const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',value=>resolve(value ?? 1));});
  results.push({suite:name,passed:code===0,durationMs:Date.now()-start});
  await record(code===0?'running':'failed');
  if (code !== 0) break;
}
const passed = results.length === suites.length && results.every(result=>result.passed);
await record(passed?'passed':'failed');
console.log(`${passed?'PASS':'FAIL'}: ${results.filter(result=>result.passed).length}/${suites.length} verification suites`);
process.exitCode=passed?0:1;
