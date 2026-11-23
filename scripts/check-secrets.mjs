import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { stdout } = await promisify(execFile)('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});
const files = [...new Set(stdout.split('\0').filter(Boolean))];
const violations = new Set(); let checked = 0;
for (const file of files) {
  if (file === '.env.example') continue;
  if (/(^|\/)\.env($|\.)/.test(file) || /(?:^|\/)(?:id_rsa|id_ed25519)$/.test(file)) { violations.add(file); continue; }
  if (!/\.(?:ts|tsx|js|mjs|cjs|json|sql|ya?ml|md|txt|pem|key)$|(?:^|\/)Dockerfile$/.test(file)) continue;
  let text; try { text = await readFile(path.join(root,file),'utf8'); } catch { continue; }
  checked++;
  if (/^-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/m.test(text)) violations.add(file);
  const tokens = text.match(/(?:gh[pousr]_[A-Za-z0-9]{32,}|github_pat_[A-Za-z0-9_]{60,}|sk-or-v1-[a-f0-9]{64}|re_[A-Za-z0-9]{32,}|\b\d{8,12}:[A-Za-z0-9_-]{35}\b)/g) || [];
  if (tokens.some(token => !/synthetic|fixture|example|xxxx|00000000/i.test(token))) violations.add(file);
}
if (violations.size) {
  // Never print credential values.
  console.error('Possible credentials in distributable files:\n' + [...violations].join('\n')); process.exitCode=1;
} else console.log(`PASS: ${checked} text files checked; no matching private keys or provider tokens. This check does not inspect Git history or provider credentials remotely.`);
