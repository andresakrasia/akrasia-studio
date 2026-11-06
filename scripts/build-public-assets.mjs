import sharp from 'sharp';
import { stat } from 'node:fs/promises';
const source = await sharp('public/img/out.jpg').metadata();
await sharp('public/img/out.jpg').resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 76, effort: 6 }).toFile('public/img/out.webp');
await sharp('public/img/og-akrasia.svg').png().toFile('public/img/og-akrasia.png');
const files = {};
for (const name of ['out.jpg', 'out.webp', 'og-akrasia.png']) files[name] = (await stat('public/img/' + name)).size;
console.log(JSON.stringify({ source: { width: source.width, height: source.height }, files }));
