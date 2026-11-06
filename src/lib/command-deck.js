// Akrasia Command Deck: the 3D home hub (Three.js).
// Progressive enhancement over the classic home: it only runs when the page set
// `html.deck-on` (WebGL2, no reduced motion, enough device memory). The real chat
// stays a normal DOM component; the deck only drives the scene, the focus cards and
// forwards actions through the site's existing `chat-trigger` / `data-video-open` hooks.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';

const CYAN = new THREE.Color('#00f0ff');

const COPY = {
  es: {
    line1: 'NO ESCRIBIMOS PROMPTS.', line2: 'DIRIGIMOS LA IA.',
    screen: 'PANTALLA', service: 'SERVICIO EN ÓRBITA', node: 'NODO',
    view: 'VER PIEZA', talkProject: 'Hablar de este proyecto', watch: 'Ver vídeo', sheet: 'Ficha',
    wantService: 'Quiero este servicio', serviceSheet: 'Ver servicio', back: 'Volver',
    sound: 'Sonido', on: 'on', off: 'off', open: 'abrir', soon: 'EN PRODUCCIÓN',
    hint: 'ARRASTRA PARA GIRAR · PULSA UNA PANTALLA O UN SERVICIO', mode: ['EXPLORAR', 'FOCO'],
    deckLabel: 'Sala 3D de Akrasia Studio: núcleo holográfico, pantallas con trabajos y servicios en órbita',
  },
  en: {
    line1: "WE DON'T PROMPT.", line2: 'WE DIRECT AI.',
    screen: 'SCREEN', service: 'SERVICE IN ORBIT', node: 'NODE',
    view: 'VIEW PIECE', talkProject: 'Talk about this project', watch: 'Watch video', sheet: 'Case study',
    wantService: 'I want this service', serviceSheet: 'Service page', back: 'Back',
    sound: 'Sound', on: 'on', off: 'off', open: 'open', soon: 'IN PRODUCTION',
    hint: 'DRAG TO ROTATE · TAP A SCREEN OR A SERVICE', mode: ['EXPLORE', 'FOCUS'],
    deckLabel: 'Akrasia Studio 3D hub: holographic core, screens with work and orbiting services',
  },
};

/** Only same-origin video files become live textures (external media needs consent). */
function localVideo(url) {
  return typeof url === 'string' && /^\/(?!\/)[\w\-./]+\.(mp4|webm)$/i.test(url) ? url : '';
}

export function createDeck(root, data) {
  const lang = data.lang === 'en' ? 'en' : 'es';
  const T = COPY[lang];
  const ac = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal });
  const MOBILE = matchMedia('(max-width: 760px)').matches;
  const HELIX = innerHeight > innerWidth * 1.05;
  const CORE_Y = HELIX ? 3.35 : 2.05;
  document.documentElement.classList.toggle('deck-helix', HELIX);

  // ── DOM scaffolding ───────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.className = 'deck-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', T.deckLabel);
  root.append(canvas);
  const hud = document.createElement('div');
  hud.className = 'deck-hud';
  hud.innerHTML = `
    <p class="deck-hint" aria-hidden="true">${T.hint}</p>
    <div class="deck-reticle" aria-hidden="true"><span>AZ <b data-az>000.0°</b></span><span>MODO <b data-mode>${T.mode[0]}</b></span><span>SECTOR <b>BCN-01</b></span></div>
    <button type="button" class="deck-sound" aria-pressed="false">♪ <span class="deck-long">${T.sound} · </span><span data-sound>${T.off}</span></button>
    <button type="button" class="deck-now"><span aria-hidden="true">▶</span> <b data-now>—</b> · ${T.open}</button>`;
  root.append(hud);
  const $h = sel => hud.querySelector(sel);

  // ── Content ───────────────────────────────────────────────────────────
  const works = (data.projects || []).slice(0, 7).map(p => ({
    slug: p.slug, title: p.title, meta: [p.category, p.duration].filter(Boolean).join(' · '),
    body: p.description || '', thumb: p.thumbnail || '', video: localVideo(p.video_url), videoUrl: p.video_url || '', id: p.id,
  }));
  const placeholder = works.length === 0;
  const screenItems = placeholder ? [0, 1, 2].map(i => ({ slug: '', title: T.soon, meta: `0${i + 1}`, body: '', thumb: '', video: '', placeholder: true })) : works;
  const services = (data.services || []).slice(0, 8);

  // ── Renderer ──────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#01060c');
  scene.fog = new THREE.FogExp2('#01060c', 0.045);
  const camera = new THREE.PerspectiveCamera(HELIX ? 62 : 50, innerWidth / innerHeight, 0.1, 200);
  const clock = new THREE.Clock();
  const uTime = { value: 0 }, uBoot = { value: 0 }, uThink = { value: 0 };
  const uRippleC = { value: new THREE.Vector2(999, 999) }, uRippleT = { value: -10 };
  const disposables = [];
  const keep = x => (disposables.push(x), x);

  // Floor grid with pulses and click ripples
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(160, 160)), keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime, uBoot, uRippleC, uRippleT, uColor: { value: CYAN } },
    vertexShader: `varying vec3 vPos; void main(){ vec4 w = modelMatrix * vec4(position,1.); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uBoot, uRippleT; uniform vec2 uRippleC; uniform vec3 uColor; varying vec3 vPos;
      float grid(vec2 p, float s, float w){ vec2 q = p / s; vec2 g = abs(fract(q - .5) - .5) / fwidth(q); return 1. - min(min(g.x, g.y) / w, 1.); }
      void main(){ float d = length(vPos.xz);
        float g = grid(vPos.xz, 1., 1.) * .35 + grid(vPos.xz, 5., 1.4) * .55;
        float pulse = exp(-pow((d - mod(uTime * 2.6, 34.)) * 1.4, 2.)) * .9;
        float age = uTime - uRippleT; float rd = length(vPos.xz - uRippleC);
        pulse += exp(-pow((rd - age * 7.) * 2.2, 2.)) * exp(-age * 1.3) * step(0., age) * 1.6;
        float reveal = 1. - smoothstep(uBoot * 46. - 2., uBoot * 46. + .5, d);
        float a = (g + pulse * (.2 + g)) * exp(-d * .055) * reveal * .75;
        gl_FragColor = vec4(uColor * (.75 + pulse * .8), a); }`,
  })));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  [1.2, 1.55, 2.05].forEach((r, i) => {
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(r, r + (i === 1 ? .05 : .015), 128)), keep(new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: i === 1 ? .9 : .5, side: THREE.DoubleSide, toneMapped: false })));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .01 + i * .002; scene.add(ring);
  });

  // ── Core: hologram Λ + particle swarm + lattice + rings + beam ────────
  const core = new THREE.Group(); core.position.y = CORE_Y; scene.add(core);
  const LAMBDA = [[0, 1], [.66, -1], [.4, -1], [0, .32], [-.4, -1], [-.66, -1]];
  const shape = new THREE.Shape(); LAMBDA.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
  const lambdaGeo = keep(new THREE.ExtrudeGeometry(shape, { depth: .22, bevelEnabled: true, bevelSize: .02, bevelThickness: .02, bevelSegments: 2 }));
  lambdaGeo.center();
  const lambdaGroup = new THREE.Group(); core.add(lambdaGroup);
  const holo = keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime, uThink },
    vertexShader: `varying vec3 vN, vV, vP; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uThink; varying vec3 vN, vV, vP;
      void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.);
        float band = .5 + .5 * sin(vP.y * 40. - uTime * 5.); float slice = step(.93, fract(vP.y * 5. + uTime * .6));
        gl_FragColor = vec4(vec3(0., .92, 1.) * (f * 2.4 + band * .3 + slice * .9) * (1. + uThink * 1.4), f * .9 + .18 + slice * .3); }`,
  }));
  const lambdaMesh = new THREE.Mesh(lambdaGeo, holo); lambdaMesh.scale.setScalar(.62); lambdaGroup.add(lambdaMesh);
  const lambdaWire = new THREE.LineSegments(keep(new THREE.EdgesGeometry(lambdaGeo)), keep(new THREE.LineBasicMaterial({ color: '#c4fcff', toneMapped: false, transparent: true, opacity: .8 })));
  lambdaWire.scale.setScalar(.64); lambdaGroup.add(lambdaWire);
  const inside = (x, y) => { let c = false; for (let i = 0, j = LAMBDA.length - 1; i < LAMBDA.length; j = i++) { const [xi, yi] = LAMBDA[i], [xj, yj] = LAMBDA[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const SWARM = MOBILE ? 1600 : 4200;
  const sTarget = new Float32Array(SWARM * 3), sStart = new Float32Array(SWARM * 3), sSeed = new Float32Array(SWARM);
  for (let i = 0; i < SWARM;) {
    const x = (Math.random() * 2 - 1) * .7, y = Math.random() * 2 - 1;
    if (!inside(x, y)) continue;
    sTarget.set([x * .66, y * .66, (Math.random() - .5) * .3], i * 3);
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1), r = 4 + Math.random() * 7;
    sStart.set([r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)], i * 3);
    sSeed[i] = Math.random(); i++;
  }
  const swarmGeo = keep(new THREE.BufferGeometry());
  swarmGeo.setAttribute('position', new THREE.BufferAttribute(sTarget, 3));
  swarmGeo.setAttribute('start', new THREE.BufferAttribute(sStart, 3));
  swarmGeo.setAttribute('seed', new THREE.BufferAttribute(sSeed, 1));
  const uAssemble = { value: 0 };
  lambdaGroup.add(new THREE.Points(swarmGeo, keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime, uThink, uAssemble, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute vec3 start; attribute float seed; uniform float uTime, uThink, uAssemble, uPx; varying float vA;
      void main(){ float k = clamp(uAssemble * 1.4 - seed * .4, 0., 1.); k = k * k * (3. - 2. * k);
        vec3 p = mix(start, position, k); float j = .015 + uThink * .09;
        p += vec3(sin(uTime * 3. + seed * 40.), cos(uTime * 2.6 + seed * 31.), sin(uTime * 2.2 + seed * 17.)) * j;
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = (1. + seed * 1.6) * uPx * (6. / -mv.z) * (1. + uThink * .6); vA = .45 + seed * .55; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(.6, .97, 1., smoothstep(.5, 0., d) * vA); }`,
  }))));
  const lattice = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(1.15, 2)), keep(new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: .14, toneMapped: false })));
  core.add(lattice);
  const rings = [[1.45, .012, [Math.PI / 2, 0, 0]], [1.62, .008, [Math.PI / 2.6, .5, 0]], [1.8, .006, [Math.PI / 1.8, -.7, .3]]].map(([r, t, rot]) => {
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(r, t, 8, 220)), keep(new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false, transparent: true, opacity: .85 })));
    ring.rotation.set(...rot); core.add(ring); return ring;
  });
  const beam = new THREE.Mesh(keep(new THREE.CylinderGeometry(.55, 1.1, 12, 48, 1, true)), keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime, uBoot, uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform float uTime, uBoot, uFade; varying vec2 vUv;
      void main(){ float a = pow(1. - vUv.y, 2.2) * .22 * (.75 + .25 * sin(vUv.x * 60. + uTime * 2.)) + pow(1. - vUv.y, 8.) * .25;
        gl_FragColor = vec4(vec3(0., .85, 1.) * a * 2. * uFade, a * uBoot * uFade); }`,
  })));
  beam.position.y = 6; scene.add(beam);

  // Dust, data streams, ceiling bars, light
  const DUST = MOBILE ? 900 : 2200;
  const dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) { const r = 1.4 + Math.pow(Math.random(), 1.6) * 16, a = Math.random() * Math.PI * 2; dustPos.set([Math.cos(a) * r, Math.random() * 8, Math.sin(a) * r], i * 3); dustSeed[i] = Math.random(); }
  const dustGeo = keep(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3)); dustGeo.setAttribute('seed', new THREE.BufferAttribute(dustSeed, 1));
  scene.add(new THREE.Points(dustGeo, keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime, uBoot, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float seed; uniform float uTime, uPx; varying float vA;
      void main(){ vec3 p = position; float t = uTime * (.05 + seed * .08); float c = cos(t), s = sin(t); p.xz = mat2(c, -s, s, c) * p.xz; p.y += sin(uTime * .6 + seed * 20.) * .15;
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = (1.2 + seed * 2.2) * uPx * (9. / -mv.z); vA = .35 + seed * .65; }`,
    fragmentShader: `uniform float uBoot; varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(.55, .95, 1., smoothstep(.5, 0., d) * vA * uBoot); }`,
  }))));
  const STREAMS = MOBILE ? 36 : 80;
  const streams = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(.035, 7)), keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime, uBoot },
    vertexShader: `varying vec2 vUv; varying float vSeed; void main(){ vUv = uv; vSeed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform float uTime, uBoot; varying vec2 vUv; varying float vSeed;
      void main(){ float d = fract(vUv.y * (2. + vSeed * 3.) - uTime * (.15 + vSeed * .35) + vSeed * 7.);
        float a = smoothstep(0., .04, d) * smoothstep(.35, .05, d) * smoothstep(1., .3, vUv.y) * smoothstep(0., .08, vUv.y) * .55 * uBoot;
        gl_FragColor = vec4(vec3(.2, .95, 1.) * 1.3, a); }`,
  })), STREAMS);
  { const m = new THREE.Object3D(); for (let i = 0; i < STREAMS; i++) { const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 7; m.position.set(Math.cos(a) * r, 3.5, Math.sin(a) * r); m.lookAt(0, 3.5, 0); m.updateMatrix(); streams.setMatrixAt(i, m.matrix); } }
  scene.add(streams);
  const bars = new THREE.Group();
  for (let i = 0; i < 9; i++) { const bar = new THREE.Mesh(keep(new THREE.BoxGeometry(2.6, .05, .14)), keep(new THREE.MeshBasicMaterial({ color: '#bffcff', toneMapped: false }))); const a = (i / 9) * Math.PI * 2; bar.position.set(Math.cos(a) * 7.5, 7.2 + (HELIX ? 1 : 0), Math.sin(a) * 7.5); bar.lookAt(0, bar.position.y, 0); bars.add(bar); }
  scene.add(bars);
  scene.add(new THREE.AmbientLight('#0b2a36', 1.2));

  // Floor cursor
  const cursorRing = new THREE.Group();
  cursorRing.add(new THREE.Mesh(keep(new THREE.RingGeometry(.26, .285, 64)), keep(new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: .9, toneMapped: false, side: THREE.DoubleSide }))));
  cursorRing.add(new THREE.Mesh(keep(new THREE.RingGeometry(.4, .405, 64, 1, 0, Math.PI * 1.4)), keep(new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: .5, toneMapped: false, side: THREE.DoubleSide }))));
  cursorRing.rotation.x = -Math.PI / 2; cursorRing.position.y = .02; cursorRing.visible = false; scene.add(cursorRing);
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), floorHit = new THREE.Vector3();

  // ── Canvas textures ───────────────────────────────────────────────────
  const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return keep(t); };
  const bevel = (g, x, y, w, h, cut) => { g.beginPath(); g.moveTo(x + cut, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - cut); g.lineTo(x + w - cut, y + h); g.lineTo(x, y + h); g.lineTo(x, y + cut); g.closePath(); };
  function buttonTag(text) {
    const c = document.createElement('canvas'); c.width = 768; c.height = 112; const g = c.getContext('2d');
    g.font = '700 40px Oxanium, sans-serif'; const label = text.toUpperCase();
    const tw = Math.min(g.measureText(label).width, 600), w = tw + 120, x = (768 - w) / 2, y = 14, h = 84;
    bevel(g, x, y, w, h, 14); g.fillStyle = '#02161fd9'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#00f0ff'; g.shadowColor = '#00f0ff'; g.shadowBlur = 12; g.stroke();
    g.shadowBlur = 0; g.fillStyle = '#00f0ff'; g.fillRect(x + 14, y + 14, 56, 56);
    g.fillStyle = '#00202a'; g.font = '800 46px Oxanium, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+', x + 42, y + 44);
    g.textAlign = 'left'; g.fillStyle = '#eafcff'; g.font = '700 40px Oxanium, sans-serif'; g.shadowColor = '#00f0ff'; g.shadowBlur = 8; g.fillText(label, x + 88, y + 44, 600);
    return tex(c);
  }
  function screenLabel(item, i) {
    const c = document.createElement('canvas'); c.width = 768; c.height = 220; const g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#00f0ff'; g.shadowBlur = 14; g.fillStyle = '#eafcff'; g.font = '800 54px Oxanium, sans-serif'; g.fillText(item.title.toUpperCase(), 384, 44, 720);
    g.shadowBlur = 0; g.fillStyle = '#7fe9f2'; g.font = '600 26px "JetBrains Mono", monospace'; g.fillText(`${String(i + 1).padStart(2, '0')}${item.meta ? ' · ' + item.meta : ''}`.toUpperCase(), 384, 98, 720);
    if (!item.placeholder) {
      bevel(g, 234, 134, 300, 66, 12); g.fillStyle = '#00f0ff'; g.shadowColor = '#00f0ff'; g.shadowBlur = 18; g.fill();
      g.shadowBlur = 0; g.fillStyle = '#00202a'; g.font = '800 30px Oxanium, sans-serif'; g.fillText('▶  ' + T.view, 384, 168);
    }
    return tex(c);
  }
  function headline() {
    const c = document.createElement('canvas'); const g = c.getContext('2d');
    if (HELIX) {
      c.width = 4096; c.height = 124; g.textBaseline = 'middle';
      const parts = [[T.line1, '#f2fbff'], ['  ' + T.line2, '#00f0ff'], ['   ◆   ', '#00f0ff']];
      g.font = '800 100px Oxanium, sans-serif';
      const measured = parts.reduce((w, [s]) => w + g.measureText(s).width, 0);
      g.font = `800 ${Math.min(84, 100 * (c.width / 2 * .97) / measured)}px Oxanium, sans-serif`;
      const unit = parts.reduce((w, [s]) => w + g.measureText(s).width, 0);
      let x = (c.width / 2 - unit) / 2;
      for (let k = 0; k < 2; k++) { for (const [s, col] of parts) { g.shadowColor = col; g.shadowBlur = col === '#00f0ff' ? 16 : 6; g.fillStyle = col; g.fillText(s, x, 64); x += g.measureText(s).width; } x += c.width / 2 - unit; }
    } else {
      c.width = 2048; c.height = 560; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 150px Oxanium, sans-serif'; g.fillStyle = '#f2fbff'; g.shadowColor = '#7ff6ff'; g.shadowBlur = 10; g.fillText(T.line1, 1024, 150, 1980);
      g.font = '800 196px Oxanium, sans-serif'; g.fillStyle = '#00f0ff'; g.shadowColor = '#00f0ff'; g.shadowBlur = 30; g.fillText(T.line2, 1024, 370, 1980);
      g.shadowBlur = 0; g.fillRect(824, 512, 400, 6);
    }
    const t = tex(c); t.wrapS = THREE.RepeatWrapping; return t;
  }
  function noiseTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 144; const g = c.getContext('2d');
    const img = g.createImageData(256, 144); for (let i = 0; i < img.data.length; i += 4) { const v = 20 + Math.random() * 40; img.data[i] = v * .4; img.data[i + 1] = v * .9; img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0); g.fillStyle = '#7fe9f2'; g.font = '700 18px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillText(T.soon, 128, 76);
    return tex(c);
  }
  const pulseTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.strokeStyle = '#00f0ff'; g.lineWidth = 5; g.shadowColor = '#00f0ff'; g.shadowBlur = 10; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke(); return tex(c); })();

  // ── Screens ───────────────────────────────────────────────────────────
  const pickables = [], screens = [];
  const count = screenItems.length;
  const ARC = MOBILE ? 6.4 : 6.8;
  const SPREAD = Math.min(.56, 2.4 / Math.max(1, count - 1));
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  screenItems.forEach((item, i) => {
    let map, video = null;
    if (item.video) {
      video = document.createElement('video');
      Object.assign(video, { src: item.video, muted: true, loop: true, playsInline: true, preload: 'auto', poster: item.thumb || '' });
      video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
      map = keep(new THREE.VideoTexture(video));
    } else if (item.thumb) {
      map = keep(loader.load(item.thumb));
    } else map = noiseTexture();
    map.colorSpace = THREE.SRGBColorSpace;
    const W = 3.9, H = 2.2, R = 5;
    const geo = keep(new THREE.PlaneGeometry(W, H, 40, 1));
    const p = geo.attributes.position;
    for (let v = 0; v < p.count; v++) { const x = p.getX(v), a = x / R; p.setXYZ(v, Math.sin(a) * R, p.getY(v), (1 - Math.cos(a)) * R); }
    geo.computeVertexNormals();
    const mat = keep(new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uTime, uHover: { value: 0 }, uOn: { value: 0 }, uDim: { value: 1 }, uSeed: { value: i * 1.7 } },
      transparent: true, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D map; uniform float uTime, uHover, uOn, uDim, uSeed; varying vec2 vUv;
        void main(){ float facing = gl_FrontFacing ? 1. : .16; vec2 uv = vUv; if (!gl_FrontFacing) uv.x = 1. - uv.x;
          float glitch = step(.985, fract(sin(floor(uTime * 9. + uSeed) * 91.3) * 43758.5)) * (1. - uHover);
          uv.x += glitch * (fract(sin(uv.y * 80. + uTime) * 999.) - .5) * .04;
          vec3 c = texture2D(map, uv).rgb; float scan = .9 + .1 * sin(uv.y * 420. - uTime * 6.);
          vec3 tint = mix(c * vec3(.55, .9, 1.) * .55, c, uHover * .8 + .2);
          float edge = smoothstep(0., .02, uv.x) * smoothstep(1., .98, uv.x) * smoothstep(0., .03, uv.y) * smoothstep(1., .97, uv.y);
          float on = smoothstep(uSeed * .1, uSeed * .1 + .35, uOn); float flick = on < .99 ? step(.4, fract(sin(uTime * 40.) * 43.)) : 1.;
          gl_FragColor = vec4(tint * scan * (.78 + uHover * .14) * uDim * facing, (.88 + uHover * .12) * edge * on * flick * (.45 + .55 * uDim) * mix(.5, 1., facing)); }`,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    const mirror = new THREE.Group();
    mirror.add(new THREE.Mesh(geo, keep(new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uOn: mat.uniforms.uOn, uDim: mat.uniforms.uDim }, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D map; uniform float uOn, uDim; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb * vec3(.55, .88, 1.), pow(1. - vUv.y, 2.6) * .3 * uOn * uDim); }`,
    }))));
    scene.add(mirror);
    const frame = new THREE.Group();
    const rail = y => { const pts = []; for (let s = 0; s <= 40; s++) { const x = -W / 2 + (W * s) / 40, a = x / R; pts.push(new THREE.Vector3(Math.sin(a) * R, y, (1 - Math.cos(a)) * R + .01)); } return pts; };
    const lineMat = keep(new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: .9, toneMapped: false }));
    frame.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(rail(H / 2 + .05))), lineMat));
    frame.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(rail(-H / 2 - .05))), lineMat));
    const label = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.4, .69)), keep(new THREE.MeshBasicMaterial({ map: screenLabel(item, i), transparent: true, toneMapped: false, depthWrite: false })));
    label.position.set(0, -H / 2 - .5, .2);
    const group = new THREE.Group(); group.add(mesh, frame, label);
    let theta, baseY;
    if (HELIX) {
      theta = Math.PI + i * (Math.PI * 2 / count); baseY = .95 + i * (5.9 / Math.max(1, count));
      group.position.set(Math.sin(theta) * 4.3, baseY, -Math.cos(theta) * 4.3); mirror.visible = false;
    } else {
      theta = (i - (count - 1) / 2) * SPREAD; baseY = 2.35 + Math.cos(i * 1.3) * .12;
      group.position.set(Math.sin(theta) * ARC, baseY, -Math.cos(theta) * ARC); group.rotation.y = -theta;
    }
    scene.add(group);
    if (!item.placeholder) { mesh.userData = label.userData = { kind: 'work', index: i }; pickables.push(mesh, label); }
    screens.push({ group, mesh, label, mat, video, theta, baseY, hover: 0, mirror, item });
  });

  // ── Headline sign ─────────────────────────────────────────────────────
  const uSign = { value: 1 };
  const signMat = keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { map: { value: headline() }, uTime, uBoot, uSign, uInside: { value: HELIX ? 0 : 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D map; uniform float uTime, uBoot, uSign, uInside; varying vec2 vUv;
      void main(){ vec2 uv = vUv; if (uInside > .5) uv.x = 1. - uv.x;
        float facing = gl_FrontFacing ? 1. : 0.; if (uInside > .5) facing = gl_FrontFacing ? .22 : 1.;
        float reveal = smoothstep(.55, .95, uBoot); float row = floor(uv.y * 24.);
        float jitter = (fract(sin(row * 91.7 + floor(uTime * 14.)) * 4375.) - .5) * (1. - reveal) * .25;
        jitter += step(.993, fract(sin(floor(uTime * 6.) * 13.1) * 917.)) * (fract(sin(row * 7.) * 99.) - .5) * .03;
        vec4 c = texture2D(map, vec2(uv.x + jitter, uv.y)); float scan = .78 + .22 * sin(uv.y * 900. - uTime * 8.);
        gl_FragColor = vec4(c.rgb * (uInside > .5 ? 1.35 : 1.05) * scan, c.a * reveal * uSign * facing); }`,
  }));
  const sign = new THREE.Mesh(keep(HELIX ? new THREE.CylinderGeometry(3.3, 3.3, .62, 160, 1, true) : new THREE.CylinderGeometry(ARC + .35, ARC + .35, 2.15, 120, 1, true, Math.PI - .82, 1.64)), signMat);
  sign.position.y = HELIX ? CORE_Y + 2.25 : 4.85;
  scene.add(sign);

  // ── Services in orbit ─────────────────────────────────────────────────
  const orbit = new THREE.Group(); orbit.position.y = CORE_Y; orbit.rotation.x = .28; scene.add(orbit);
  const nodes = services.map((service, i) => {
    const g = new THREE.Group();
    const solid = new THREE.Mesh(keep(new THREE.OctahedronGeometry(.13)), keep(new THREE.MeshBasicMaterial({ color: '#7ff6ff', toneMapped: false })));
    const shell = new THREE.Mesh(keep(new THREE.OctahedronGeometry(.24)), keep(new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: .55, toneMapped: false })));
    const hit = new THREE.Mesh(keep(new THREE.SphereGeometry(.45, 8, 8)), keep(new THREE.MeshBasicMaterial({ visible: false })));
    const tag = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: buttonTag(service.title), transparent: true, depthWrite: false, toneMapped: false })));
    tag.scale.set(1.55, .226, 1); tag.position.y = .44;
    const pulse = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: pulseTex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })));
    const tagHit = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.55, .3)), keep(new THREE.MeshBasicMaterial({ visible: false }))); tagHit.position.y = .44;
    g.add(solid, shell, hit, tag, pulse, tagHit);
    hit.userData = tagHit.userData = { kind: 'service', index: i }; pickables.push(hit, tagHit);
    orbit.add(g);
    return { g, solid, shell, tag, pulse, base: (i / Math.max(1, services.length)) * Math.PI * 2, hover: 0, service };
  });
  const orbitPath = new THREE.Mesh(keep(new THREE.TorusGeometry(2.6, .004, 6, 256)), keep(new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: .35, toneMapped: false })));
  orbitPath.rotation.x = Math.PI / 2; orbit.add(orbitPath);

  // ── Post-processing ───────────────────────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), MOBILE ? .7 : .85, .45, .6));
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
      void main(){ vec2 c = vUv - .5; float d = dot(c, c); vec2 off = c * d * .018;
        vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
        col *= .965 + .035 * sin(vUv.y * uRes.y * 1.1);
        float n = fract(sin(dot(vUv * uRes + uTime * 61., vec2(12.9898, 78.233))) * 43758.5453);
        col += (n - .5) * .03; col *= 1. - d * 1.15; gl_FragColor = vec4(col, 1.); }`,
  });
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  // ── Focus card (real DOM in 3D space via CSS3D) ───────────────────────
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(innerWidth, innerHeight);
  cssRenderer.domElement.className = 'deck-css3d';
  root.append(cssRenderer.domElement);
  const cssScene = new THREE.Scene();
  const cardWrap = document.createElement('div'); cardWrap.className = 'deck-card-wrap';
  const card = document.createElement('aside'); card.className = 'deck-card'; card.setAttribute('aria-live', 'polite'); card.hidden = true;
  cardWrap.append(card);
  const cardObj = new CSS3DObject(cardWrap); cardObj.scale.setScalar(HELIX ? .0064 : .0062); cssScene.add(cardObj);
  const cardTarget = new THREE.Vector3(), camRight = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  let cardSnap = true;
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  // ── Interaction state ─────────────────────────────────────────────────
  const rig = { az: 0, azTarget: 0, el: HELIX ? .1 : .2, dist: HELIX ? 12.6 : 8.6, look: new THREE.Vector3(0, CORE_Y, 0) };
  const desired = { pos: new THREE.Vector3(), look: new THREE.Vector3(0, 2, 0) };
  const mouse = new THREE.Vector2(), parallax = new THREE.Vector2();
  let focused = null, dragging = false, dragX = 0, moved = 0, focusFade = 0, lastInput = 0, servicesMode = false, frontIndex = 0, orbitClock = 0, thinking = false, talked = false;
  const rigPosition = out => out.set(Math.sin(rig.az) * rig.dist * Math.cos(rig.el), (HELIX ? CORE_Y : 2) + Math.sin(rig.el) * rig.dist, Math.cos(rig.az) * rig.dist * Math.cos(rig.el));
  camera.position.copy(rigPosition(new THREE.Vector3()).multiplyScalar(1.8)).setY(HELIX ? 11 : 7);
  const raycaster = new THREE.Raycaster();
  let hovered = null;

  // Optional interface sound (off by default)
  const sfx = {
    ctx: null, master: null, on: false,
    init() {
      if (this.ctx) return;
      const C = new (window.AudioContext || window.webkitAudioContext)();
      const master = C.createGain(); master.gain.value = 0; master.connect(C.destination);
      const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 6; lp.connect(master);
      [[55, 'sawtooth', .05], [55.35, 'sawtooth', .05], [110.1, 'sine', .04], [164.8, 'sine', .015]].forEach(([f, type, gv]) => { const o = C.createOscillator(); o.type = type; o.frequency.value = f; const gain = C.createGain(); gain.gain.value = gv; o.connect(gain); gain.connect(lp); o.start(); });
      const lfo = C.createOscillator(); lfo.frequency.value = .07; const depth = C.createGain(); depth.gain.value = 90; lfo.connect(depth); depth.connect(lp.frequency); lfo.start();
      this.ctx = C; this.master = master;
    },
    toggle() {
      this.init(); this.on = !this.on; this.ctx.resume();
      this.master.gain.setTargetAtTime(this.on ? .55 : 0, this.ctx.currentTime, .5);
      $h('.deck-sound').setAttribute('aria-pressed', String(this.on)); $h('[data-sound]').textContent = this.on ? T.on : T.off;
      if (this.on) this.blip(880, .12, .06);
    },
    blip(freq = 1500, dur = .05, vol = .035) {
      if (!this.on) return; const C = this.ctx, o = C.createOscillator(), g = C.createGain(), t0 = C.currentTime;
      o.frequency.setValueAtTime(freq, t0); o.frequency.exponentialRampToValueAtTime(freq * 1.5, t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur); o.connect(g); g.connect(C.destination); o.start(t0); o.stop(t0 + dur + .02);
    },
    sweep() {
      if (!this.on) return; const C = this.ctx, t0 = C.currentTime, len = .7;
      const buf = C.createBuffer(1, C.sampleRate * len, C.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = C.createBufferSource(); src.buffer = buf; const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8;
      bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(3200, t0 + len);
      const g = C.createGain(); g.gain.value = .09; src.connect(bp); bp.connect(g); g.connect(C.destination); src.start(t0);
    },
    close() { this.ctx?.close().catch(() => {}); },
  };
  on($h('.deck-sound'), 'click', () => sfx.toggle());

  function showCard(html) {
    if (card.hidden) cardSnap = true;
    card.innerHTML = html; card.hidden = false;
    requestAnimationFrame(() => card.classList.add('on'));
    $h('[data-mode]').textContent = T.mode[1];
    document.documentElement.classList.add('deck-focusing');
  }
  function focusWork(i) {
    const s = screens[i]; if (!s || s.item.placeholder) return;
    sfx.sweep(); focused = { kind: 'work', index: i };
    const dir = tmpA.set(Math.sin(s.theta), 0, -Math.cos(s.theta)).clone(), right = new THREE.Vector3(Math.cos(s.theta), 0, Math.sin(s.theta));
    if (HELIX) { desired.look.copy(s.group.position).setY(s.baseY - 1.1); desired.pos.copy(s.group.position).addScaledVector(dir, 6.4).setY(s.baseY + .2); }
    else { const shift = MOBILE ? 0 : 1.55; desired.look.copy(s.group.position).addScaledVector(right, shift).setY(s.group.position.y - (MOBILE ? .6 : 0)); desired.pos.copy(s.group.position).addScaledVector(dir, MOBILE ? -6.2 : -5.6).addScaledVector(right, shift).setY(s.group.position.y + .1); }
    const w = s.item;
    const chat = lang === 'en' ? `I want information about the project: ${w.slug}` : `Quiero información sobre el proyecto: ${w.slug}`;
    showCard(`<p class="deck-card__eyebrow">${T.screen} ${String(i + 1).padStart(2, '0')}</p>
      <h2>${esc(w.title)}</h2>${w.meta ? `<p class="deck-card__meta">${esc(w.meta)}</p>` : ''}${w.body ? `<p class="deck-card__body">${esc(w.body)}</p>` : ''}
      <div class="deck-card__actions">
        <button type="button" class="deck-act primary" data-chat-message="${esc(chat)}">${T.talkProject} <span aria-hidden="true">↗</span></button>
        ${w.videoUrl ? `<button type="button" class="deck-act" data-video-open data-project-id="${esc(w.id)}" data-project-video="${esc(w.videoUrl)}" data-project-title="${esc(w.title)}"><span aria-hidden="true">▶</span> ${T.watch}</button>` : ''}
        <a class="deck-act" href="/proyectos/${encodeURIComponent(w.slug)}${lang === 'en' ? '?lang=en' : ''}">${T.sheet}</a>
        <button type="button" class="deck-act ghost" data-deck-back><span aria-hidden="true">←</span> ${T.back}</button>
      </div>`);
  }
  function focusService(i) {
    const n = nodes[i]; if (!n) return;
    sfx.sweep(); focused = { kind: 'service', index: i };
    const sv = n.service;
    const chat = lang === 'en' ? `I want information about the service: ${sv.slug}` : `Quiero información sobre el servicio: ${sv.slug}`;
    showCard(`<p class="deck-card__eyebrow">${T.service} · ${T.node} ${String(i + 1).padStart(2, '0')}</p>
      <h2>${esc(sv.title)}</h2>${sv.summary ? `<p class="deck-card__body">${esc(sv.summary)}</p>` : ''}
      <div class="deck-card__actions">
        <button type="button" class="deck-act primary" data-chat-message="${esc(chat)}">${T.wantService} <span aria-hidden="true">↗</span></button>
        <a class="deck-act" href="/servicios/${encodeURIComponent(sv.slug)}${lang === 'en' ? '?lang=en' : ''}">${T.serviceSheet}</a>
        <button type="button" class="deck-act ghost" data-deck-back><span aria-hidden="true">←</span> ${T.back}</button>
      </div>`);
  }
  function unfocus() {
    if (!focused) return;
    if (focused.kind === 'work' && HELIX) rig.azTarget = rig.az = Math.atan2(camera.position.x, camera.position.z);
    focused = null; card.classList.remove('on'); setTimeout(() => { if (!focused) card.hidden = true; }, 400);
    $h('[data-mode]').textContent = T.mode[0];
    document.documentElement.classList.remove('deck-focusing');
  }
  on(card, 'click', e => { if (e.target.closest('[data-deck-back]')) unfocus(); });
  on(document, 'keydown', e => { if (e.key === 'Escape' && focused) unfocus(); });
  // Anything sent to the chat (cards, header, starters) returns the view to the conversation.
  on(document, 'chat-trigger', e => {
    const msg = String(e.detail?.message || '');
    unfocus();
    if (/servicios|services/i.test(msg) && !/servicio:|service:/.test(msg)) { servicesMode = true; rig.dist = HELIX ? 10.5 : 7; }
  });
  on($h('.deck-now'), 'click', () => focusWork(frontIndex));

  // Pointer
  on(canvas, 'pointermove', e => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (dragging) { const dx = e.clientX - dragX; dragX = e.clientX; moved += Math.abs(dx); rig.azTarget -= dx * (HELIX ? .009 : .005); lastInput = performance.now(); }
  });
  on(canvas, 'pointerdown', e => { dragging = true; dragX = e.clientX; moved = 0; canvas.setPointerCapture(e.pointerId); sfx.ctx?.resume(); });
  on(canvas, 'pointerup', e => {
    dragging = false; if (moved > 6) return;
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit) hit.object.userData.kind === 'work' ? focusWork(hit.object.userData.index) : focusService(hit.object.userData.index);
    else { if (focused) unfocus(); if (raycaster.ray.intersectPlane(floorPlane, floorHit)) { uRippleC.value.set(floorHit.x, floorHit.z); uRippleT.value = uTime.value; sfx.blip(420, .18, .05); } }
  });
  on(canvas, 'wheel', e => { rig.dist = THREE.MathUtils.clamp(rig.dist + e.deltaY * .004, 6.5, 15); }, { passive: true });

  // The chat drives the core: thinking makes it tremble; first message dims the sign.
  const chatSurface = () => document.querySelector('.chat-surface');
  const observer = new MutationObserver(() => {
    const phase = chatSurface()?.getAttribute('data-chat-phase') || 'idle';
    thinking = phase !== 'idle' && phase !== 'ready';
    if (document.querySelector('.chat-transcript[data-welcome-only="false"]')) talked = true;
    else showGreetingTop();
  });
  // While only the greeting is present, show the terminal from its first line.
  function showGreetingTop() { const layer = document.querySelector('.chat-layer'); if (layer && document.querySelector('.chat-transcript[data-welcome-only="true"]')) layer.scrollTop = 0; }
  setTimeout(showGreetingTop, 600); setTimeout(showGreetingTop, 2000);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-chat-phase', 'data-welcome-only'] });

  // Videos: offset their start so fade-to-black endings never coincide.
  screens.forEach((s, i) => {
    if (!s.video) return;
    const go = () => { try { s.video.currentTime = (i * 1.7) % Math.max(1, (s.video.duration || 8) - 1); } catch { /* ignore */ } s.video.play().catch(() => {}); };
    s.video.readyState >= 1 ? go() : on(s.video, 'loadedmetadata', go, { once: true });
  });

  // ── Loop ──────────────────────────────────────────────────────────────
  const bootStart = performance.now();
  setTimeout(() => $h('.deck-hint')?.classList.add('gone'), 9000);
  function frame() {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    uTime.value = t;
    const boot = THREE.MathUtils.clamp((performance.now() - bootStart - 300) / 2600, 0, 1);
    uBoot.value = boot;
    uAssemble.value = THREE.MathUtils.smoothstep(boot, .05, .8);
    uThink.value += ((thinking ? 1 : 0) - uThink.value) * Math.min(1, dt * 5);
    lambdaGroup.rotation.y = t * .45;
    lattice.rotation.y = -t * .12; lattice.rotation.x = t * .05;
    rings.forEach((r, i) => { r.rotation.z += dt * (.25 + i * .18) * (i % 2 ? -1 : 1) * (1 + uThink.value * 3); });
    core.position.y = CORE_Y + Math.sin(t * 1.1) * .06;
    focusFade += ((focused?.kind === 'work' ? 1 : 0) - focusFade) * Math.min(1, dt * 3);
    const recede = 1 - focusFade * .92;
    core.scale.setScalar(THREE.MathUtils.lerp(.001, 1, THREE.MathUtils.smoothstep(boot, .1, .7)) * recede);
    orbit.scale.setScalar(Math.max(.001, recede));
    beam.material.uniforms.uFade.value = recede;
    bars.children.forEach((b, i) => { b.material.color.setScalar(boot > i / 9 ? 1 : .05); });

    raycaster.setFromCamera(mouse, camera);
    const hit = dragging ? null : raycaster.intersectObjects(pickables, false)[0]?.object ?? null;
    if (hit !== hovered) { hovered = hit; canvas.style.cursor = hit ? 'pointer' : 'grab'; if (hit) sfx.blip(); }
    const overFloor = !hit && !focused && !MOBILE && raycaster.ray.intersectPlane(floorPlane, floorHit) && floorHit.length() < 16;
    cursorRing.visible = !!overFloor;
    if (overFloor) { cursorRing.position.x += (floorHit.x - cursorRing.position.x) * Math.min(1, dt * 14); cursorRing.position.z += (floorHit.z - cursorRing.position.z) * Math.min(1, dt * 14); cursorRing.rotation.z = -t * .8; }

    if (HELIX && !focused && !dragging && performance.now() - lastInput > 2500) rig.azTarget += dt * .12;
    rig.az += (rig.azTarget - rig.az) * Math.min(1, dt * 4);
    if (HELIX) {
      let best = 1e9;
      screens.forEach((s, i) => { if (s.item.placeholder) return; const d = Math.abs(Math.atan2(Math.sin(s.theta - Math.PI + rig.az), Math.cos(s.theta - Math.PI + rig.az))); if (d < best) { best = d; frontIndex = i; } });
      const now = screens[frontIndex]?.item;
      $h('[data-now]').textContent = now && !now.placeholder ? now.title : '—';
      sign.rotation.y -= dt * .05;
    }
    screens.forEach((s, i) => {
      const target = (hovered === s.mesh || hovered === s.label || (focused?.kind === 'work' && focused.index === i) || (HELIX && !focused && i === frontIndex && !s.item.placeholder)) ? 1 : 0;
      s.hover += (target - s.hover) * Math.min(1, dt * 6);
      s.mat.uniforms.uHover.value = s.hover;
      s.mat.uniforms.uOn.value = THREE.MathUtils.clamp((boot - .35) * 1.8, 0, 1);
      s.group.position.y = s.baseY + Math.sin(t * .7 + i) * .05;
      s.group.scale.setScalar(1 + s.hover * .04);
      let dimTarget = focused?.kind === 'work' && focused.index !== i ? .28 : 1;
      if (HELIX) {
        const gx = s.group.position.x, gz = s.group.position.z;
        s.group.rotation.y = Math.atan2(camera.position.x - gx, camera.position.z - gz);
        if (!focused && gx * camera.position.x + gz * camera.position.z < 0) dimTarget = .42;
      }
      s.mat.uniforms.uDim.value += (dimTarget - s.mat.uniforms.uDim.value) * Math.min(1, dt * 4);
      s.mirror.position.set(s.group.position.x, -s.group.position.y, s.group.position.z);
      s.mirror.rotation.y = s.group.rotation.y;
      s.mirror.scale.set(s.group.scale.x, -s.group.scale.y, s.group.scale.z);
    });
    if (focused?.kind !== 'service') orbitClock += dt;
    nodes.forEach((n, i) => {
      const target = (hovered?.parent === n.g || (focused?.kind === 'service' && focused.index === i)) ? 1 : 0;
      n.hover += (target - n.hover) * Math.min(1, dt * 6);
      const a = n.base + orbitClock * .16;
      n.g.position.set(Math.cos(a) * 2.6, Math.sin(t * .9 + i) * .08, Math.sin(a) * 2.6);
      n.g.scale.setScalar((1 + n.hover * .6) * THREE.MathUtils.smoothstep(boot, .45, .85));
      n.shell.rotation.y = t * .8; n.solid.rotation.y = -t * 1.2;
      n.tag.material.opacity = (servicesMode ? 1 : .72) + n.hover * .28;
      n.tag.scale.set(1.55 * (1 + n.hover * .12), .226 * (1 + n.hover * .12), 1);
      const k = (t * .55 + i * .17) % 1;
      n.pulse.scale.setScalar(.35 + k * .9); n.pulse.material.opacity = (1 - k) * (.55 + n.hover * .4);
    });
    uSign.value += ((focused ? .25 : talked ? .7 : 1) - uSign.value) * Math.min(1, dt * 2);

    parallax.lerp(mouse, Math.min(1, dt * 2.5));
    if (!focused || focused.kind === 'service') {
      rigPosition(desired.pos);
      desired.pos.x += parallax.x * .6; desired.pos.y += parallax.y * .35;
      if (HELIX) desired.look.set(parallax.x * .3, CORE_Y - .7 + parallax.y * .2, 0);
      else desired.look.set(parallax.x * .4, 2.25 + parallax.y * .2, -1.2);
    }
    const ease = Math.min(1, dt * (focused ? 3 : 1.6));
    camera.position.lerp(desired.pos, ease);
    rig.look.lerp(desired.look, ease);
    camera.lookAt(rig.look);
    // Let the DOM terminal lean with the camera so it reads as part of the room.
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(camera.position.x, camera.position.z));
    document.documentElement.style.setProperty('--deck-yaw', `${(-yaw * .35).toFixed(2)}deg`);
    document.documentElement.style.setProperty('--deck-pitch', `${(parallax.y * 2).toFixed(2)}deg`);
    $h('[data-az]').textContent = (((yaw % 360) + 360) % 360).toFixed(1).padStart(5, '0') + '°';

    if (focused) {
      if (focused.kind === 'work') {
        const s = screens[focused.index]; const dir = tmpA.set(Math.sin(s.theta), 0, -Math.cos(s.theta));
        if (HELIX) cardTarget.copy(s.group.position).addScaledVector(dir, 1.9).setY(s.baseY - .95);
        else cardTarget.copy(s.group.position).addScaledVector(tmpB.set(Math.cos(s.theta), 0, Math.sin(s.theta)), 2.75).addScaledVector(dir, -.55);
      } else {
        nodes[focused.index].g.getWorldPosition(cardTarget);
        camRight.setFromMatrixColumn(camera.matrixWorld, 0);
        if (HELIX) { cardTarget.addScaledVector(tmpA.subVectors(camera.position, cardTarget).normalize(), 3.4); cardTarget.y -= 1.05; }
        else cardTarget.addScaledVector(camRight, 1.75).y += .1;
      }
      if (cardSnap) { cardObj.position.copy(cardTarget); cardSnap = false; } else cardObj.position.lerp(cardTarget, Math.min(1, dt * 5));
      cardObj.lookAt(camera.position);
    }
    composer.render();
    cssRenderer.render(cssScene, camera);
  }
  renderer.setAnimationLoop(frame);
  on(document, 'visibilitychange', () => renderer.setAnimationLoop(document.hidden ? null : frame));
  on(window, 'resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); cssRenderer.setSize(innerWidth, innerHeight);
    lens.uniforms.uRes.value.set(innerWidth, innerHeight);
  });
  document.fonts?.ready.then(() => {
    if (ac.signal.aborted) return;
    signMat.uniforms.map.value = headline();
    nodes.forEach(n => { n.tag.material.map = buttonTag(n.service.title); });
    screens.forEach((s, i) => { s.label.material.map = screenLabel(s.item, i); });
  });

  return {
    focusWork, focusService, unfocus,
    dispose() {
      ac.abort(); observer.disconnect(); renderer.setAnimationLoop(null); sfx.close();
      screens.forEach(s => { if (s.video) { s.video.pause(); s.video.removeAttribute('src'); s.video.load(); } });
      disposables.forEach(d => d.dispose?.()); composer.dispose?.(); renderer.dispose();
      root.replaceChildren();
      document.documentElement.classList.remove('deck-focusing', 'deck-helix');
    },
  };
}
