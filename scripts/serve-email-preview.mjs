import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4363;
const server = createServer(async (request,response) => {
  const pathname = new URL(request.url,'http://localhost').pathname;
  const individual = /^\/email-preview-(evaluation|quote|follow_up|kickoff|progress|delivery|final_delivery|closure|custom|booking_confirmation|booking_reminder)\.html$/.test(pathname);
  if (request.method !== 'GET' || !individual && !['/','/email-templates-preview.html','/img/email-studio-core.png'].includes(pathname)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const logo = pathname.endsWith('.png');
    const bytes = await readFile(path.join(root,logo ? 'public/img/email-studio-core.png' : individual ? `docs/evidence/${pathname.slice(1)}` : 'docs/evidence/email-templates-preview.html'));
    response.writeHead(200,{'content-type':logo?'image/png':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); response.end(bytes);
  } catch { response.writeHead(503); response.end('Run node scripts/test-email-templates.mjs first.'); }
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic email gallery: http://127.0.0.1:${port}/`));
process.on('SIGINT',()=>server.close()); process.on('SIGTERM',()=>server.close());
