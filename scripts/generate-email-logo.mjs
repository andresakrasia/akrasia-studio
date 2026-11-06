import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Rasterize the actual StudioCore geometry at its initial, still frame. No
// redesign, generative image or runtime SVG support is needed in email clients.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'src/components/StudioCore.tsx'), 'utf8');
const geometrySource = source.slice(source.indexOf('const FRAME_INTERVAL'), source.indexOf('function StudioCore('));
const compiled = ts.transpileModule(`${geometrySource}\ngeometry();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = vm.createContext({ Math });
const scene = vm.runInContext(compiled, context, { timeout: 1000 });
const project = vm.runInContext('projector(300, 300, .42)', context, { timeout: 1000 });
const point = value => `${value.x.toFixed(3)},${value.y.toFixed(3)}`;
const segment = (a, b) => `M${point(a)}L${point(b)}`;
const bright = .72;
let drawing = '<defs><radialGradient id="email-halo"><stop offset="0" stop-color="#2274ff" stop-opacity=".1296"/><stop offset=".45" stop-color="#0676c5" stop-opacity=".108"/><stop offset=".78" stop-color="#1ad3f0" stop-opacity=".0648"/><stop offset="1" stop-color="#122a5a" stop-opacity="0"/></radialGradient></defs><rect width="300" height="300" fill="#0a0a0a"/><circle cx="150" cy="150" r="147" fill="url(#email-halo)"/>';
const circles = scene.circles.map(circle => circle.map(project));
for (const front of [false, true]) {
  let d = '';
  for (const circle of circles) for (let index = 0; index < circle.length; index++) {
    const a = circle[index], b = circle[(index + 1) % circle.length];
    if ((a.z + b.z > 0) === front) d += segment(a, b);
  }
  drawing += `<path d="${d}" fill="none" stroke="${front ? '#46e7ff' : '#2688f6'}" stroke-opacity="${(front ? .56 : .2) * bright}" stroke-width="${front ? .75 : .5}"/>`;
}
const nodes = scene.nodes.map(project);
drawing += `<path d="${scene.links.filter(([a,b]) => nodes[a].z + nodes[b].z >= -.4).map(([a,b]) => segment(nodes[a],nodes[b])).join('')}" fill="none" stroke="#2e9dff" stroke-opacity="${.26 * bright}" stroke-width=".55"/>`;
scene.orbits.forEach((orbit, index) => {
  const positions = orbit.map(project);
  drawing += `<path d="M${positions.map(point).join('L')}Z" fill="none" stroke="${['#47e6ff','#2a94ff','#63d3ff'][index]}" stroke-opacity="${[.57,.58,.46][index] * bright}" stroke-width="${index === 1 ? 1 : .75}"/>`;
  const moving = vm.runInContext(`projector(300,300,.42)(orbitPoint(${index},.42*(1+${index}*.15)+${index}*2.1))`,context,{timeout:1000});
  drawing += `<circle cx="${moving.x}" cy="${moving.y}" r="${index === 1 ? 2.2 : 1.7}" fill="${['#b1faff','#82cfff','#c4edff'][index]}"/>`;
});
nodes.forEach((node,index) => {
  if (node.z < -.65) return;
  drawing += `<circle cx="${node.x}" cy="${node.y}" r="${.65 + (node.z + 1) * .55}" fill="${index % 6 === 0 ? '#e0ffff' : '#5be9ff'}" fill-opacity="${index % 6 === 0 ? 1 : (.3 + (node.z + 1) * .3) * bright}"/>`;
});
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
try {
  const { default: StudioCore } = await vite.ssrLoadModule('/src/components/StudioCore.tsx');
  const markup = renderToStaticMarkup(createElement(StudioCore, { phase: 'idle', paused: true }));
  const projection = markup.match(/<svg class="studio-core__projection"[\s\S]*?<\/svg>/)?.[0];
  if (!projection) throw new Error('StudioCore projection missing');
  const inner = projection.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 300 300">${drawing}<g fill="none">${inner}</g></svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(root, 'public/img/email-studio-core.png'), png);
  console.log(`StudioCore email logo: 600 × 600 PNG, ${png.byteLength} bytes.`);
} finally { await vite.close(); }
