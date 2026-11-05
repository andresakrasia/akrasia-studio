// Fictitious inputs for the isolated dashboard browser QA only.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/qa/a10');
await mkdir(output, { recursive: true });
await sharp({ create: { width: 128, height: 80, channels: 3, background: '#225588' } }).png().toFile(path.join(output, 'ficticia.png'));
await writeFile(path.join(output, 'corrupta.png'), '<svg onload=alert(1)>fake</svg>');
await writeFile(path.join(output, 'excesiva.png'), Buffer.alloc(2 * 1024 * 1024 + 1));
console.log('Fictitious A10 browser files generated in docs/qa/a10; use only the isolated preview.');
