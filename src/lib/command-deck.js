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
    keysLabel: 'Proyectos y servicios de la sala', project: 'Proyecto', serviceWord: 'Servicio', enter: 'Intro para abrir',
  },
  en: {
    line1: "WE DON'T PROMPT.", line2: 'WE DIRECT AI.',
    screen: 'SCREEN', service: 'SERVICE IN ORBIT', node: 'NODE',
    view: 'VIEW PIECE', talkProject: 'Talk about this project', watch: 'Watch video', sheet: 'Case study',
    wantService: 'I want this service', serviceSheet: 'Service page', back: 'Back',
    sound: 'Sound', on: 'on', off: 'off', open: 'open', soon: 'IN PRODUCTION',
    hint: 'DRAG TO ROTATE · TAP A SCREEN OR A SERVICE', mode: ['EXPLORE', 'FOCUS'],
    deckLabel: 'Akrasia Studio 3D hub: holographic core, screens with work and orbiting services',
    keysLabel: 'Projects and services in the room', project: 'Project', serviceWord: 'Service', enter: 'Enter to open',
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
    <p class="deck-hint" aria-hidden="true"><span class="deck-hint__ico">⟷</span>${T.hint}</p>
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
  const FULL_RATIO = Math.min(devicePixelRatio, MOBILE ? 1.5 : 1.75);
  renderer.setPixelRatio(FULL_RATIO);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#01060c');
  scene.fog = new THREE.FogExp2('#01060c', 0.045);
  const camera = new THREE.PerspectiveCamera(HELIX ? 62 : 50, innerWidth / innerHeight, 0.1, 200);
  const clock = new THREE.Clock();
  const uTime = { value: 0 }, uBoot = { value: 0 }, uThink = { value: 0 }, uPx = { value: FULL_RATIO };
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
    uniforms: { uTime, uThink, uAssemble, uPx },
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
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime, uBoot, uPx },
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
      g.font = '800 150px Oxanium, sans-serif'; g.fillStyle = '#f2fbff'; g.shadowColor = '#7ff6ff'; g.shadowBlur = 5; g.fillText(T.line1, 1024, 150, 1980);
      g.font = '800 196px Oxanium, sans-serif'; g.fillStyle = '#00f0ff'; g.shadowColor = '#00f0ff'; g.shadowBlur = 12; g.fillText(T.line2, 1024, 370, 1980);
      g.shadowBlur = 0; g.fillRect(824, 512, 400, 6);
    }
    const t = tex(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
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
    // The wall starts with still covers; clips are fetched later, on demand (see "Video on demand").
    const map = item.thumb ? keep(loader.load(item.thumb)) : noiseTexture();
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
    const mirrorMat = mirror.children[0].material;
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
    screens.push({ group, mesh, label, mat, mirrorMat, still: map, video: null, vtex: null, theta, baseY, hover: 0, mirror, item });
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
        vec4 c = texture2D(map, vec2(uv.x + jitter, uv.y)); float scan = uInside > .5 ? .9 + .1 * sin(uv.y * 240. - uTime * 8.) : .78 + .22 * sin(uv.y * 900. - uTime * 8.);
        gl_FragColor = vec4(c.rgb * (uInside > .5 ? 1.15 : 1.05) * scan, c.a * reveal * uSign * facing);
        #include <colorspace_fragment>
      }`,
  }));
  const sign = new THREE.Mesh(keep(HELIX ? new THREE.CylinderGeometry(3.3, 3.3, .62, 160, 1, true) : new THREE.CylinderGeometry(ARC + .35, ARC + .35, 2.15, 120, 1, true, Math.PI - .82, 1.64)), signMat);
  sign.position.y = HELIX ? CORE_Y + 2.25 : 4.85;
  // The wide headline is drawn after the post-processing so bloom, grain and
  // lens fringing don't smear the studio's main message.
  const SIGN_LAYER = 1;
  if (!HELIX) sign.layers.set(SIGN_LAYER);
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), MOBILE ? .7 : .85, .45, .6);
  composer.addPass(bloom);
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
  const cardObj = new CSS3DObject(cardWrap); cardObj.scale.setScalar(HELIX ? .005 : .0062); cssScene.add(cardObj);
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
  // Conversation view: on arrival the camera sits closer to the chat terminal so its
  // text can be read; exploring the room (drag, zoom, focus) pulls back to the wide view,
  // and talking to the chat brings it near again.
  const CHAT_POSE = { pos: new THREE.Vector3(-1.1, 3.55, 7.5), look: new THREE.Vector3(-.75, 2.35, -1.2) };
  let chatView = HELIX ? 0 : 1, chatMix = chatView;
  const setChatView = near => { chatView = near && !HELIX ? 1 : 0; };
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
    const back = kbReturn && card.contains(document.activeElement) ? kbReturn : null; kbReturn = null;
    focused = null; card.classList.remove('on'); setTimeout(() => { if (!focused) card.hidden = true; }, 400);
    back?.focus({ preventScroll: true });
    $h('[data-mode]').textContent = T.mode[0];
    document.documentElement.classList.remove('deck-focusing');
  }
  on(card, 'click', e => { if (e.target.closest('[data-deck-back]')) unfocus(); });

  // ── Keyboard access ───────────────────────────────────────────────────
  // Real buttons (hidden until focused) mirror every screen and service, so the room can be
  // walked with Tab and opened with Enter; the arrows turn the room or step between pieces.
  const keys = document.createElement('div');
  keys.className = 'deck-keys'; keys.setAttribute('role', 'group'); keys.setAttribute('aria-label', T.keysLabel);
  keys.innerHTML = screens.map((sc, i) => sc.item.placeholder ? '' : `<button type="button" data-key-kind="work" data-key-index="${i}">${T.project}: ${esc(sc.item.title)}<small aria-hidden="true"> · ${T.enter}</small></button>`).join('')
    + nodes.map((n, i) => `<button type="button" data-key-kind="service" data-key-index="${i}">${T.serviceWord}: ${esc(n.service.title)}<small aria-hidden="true"> · ${T.enter}</small></button>`).join('');
  hud.append(keys);
  let kbTarget = null, kbReturn = null;
  const faceScreen = i => { if (!HELIX) return; const goal = Math.PI - screens[i].theta; rig.azTarget = rig.az + Math.atan2(Math.sin(goal - rig.az), Math.cos(goal - rig.az)); lastInput = performance.now(); };
  on(keys, 'focusin', e => {
    const b = e.target.closest('button'); if (!b) return;
    kbTarget = { kind: b.dataset.keyKind, index: Number(b.dataset.keyIndex) };
    setChatView(false); dismissHint();
    if (kbTarget.kind === 'work') faceScreen(kbTarget.index);
  });
  on(keys, 'focusout', () => { kbTarget = null; });
  on(keys, 'click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = Number(b.dataset.keyIndex);
    b.dataset.keyKind === 'work' ? focusWork(i) : focusService(i);
    kbReturn = b; card.querySelector('button, a')?.focus({ preventScroll: true });
  });
  on(document, 'keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const el = document.activeElement;
    if (el && el !== document.body && !keys.contains(el) && !card.contains(el)) return;
    const step = e.key === 'ArrowRight' ? 1 : -1;
    if (focused?.kind === 'work') {
      const open = screens.map((sc, i) => sc.item.placeholder ? -1 : i).filter(i => i >= 0);
      const nextIndex = open[(open.indexOf(focused.index) + step + open.length) % open.length];
      focusWork(nextIndex); card.querySelector('button, a')?.focus({ preventScroll: true });
    } else if (!focused) {
      rig.azTarget += step * (HELIX ? .5 : .3); lastInput = performance.now(); setChatView(false); dismissHint();
    } else return;
    e.preventDefault();
  });
  on(document, 'keydown', e => { if (e.key === 'Escape' && focused) unfocus(); });
  // Anything sent to the chat (cards, header, starters) returns the view to the conversation.
  on(document, 'chat-trigger', e => {
    const msg = String(e.detail?.message || '');
    unfocus();
    if (/servicios|services/i.test(msg) && !/servicio:|service:/.test(msg)) { servicesMode = true; rig.dist = HELIX ? 10.5 : 7; setChatView(false); }
    else setChatView(true);
  });
  on($h('.deck-now'), 'click', () => focusWork(frontIndex));

  // Pointer
  on(canvas, 'pointermove', e => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (dragging) { const dx = e.clientX - dragX; dragX = e.clientX; moved += Math.abs(dx); rig.azTarget -= dx * (HELIX ? .009 : .005); lastInput = performance.now(); if (moved > 6) setChatView(false); }
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
  on(canvas, 'wheel', e => { setChatView(false); rig.dist = THREE.MathUtils.clamp(rig.dist + e.deltaY * .004, 6.5, 15); }, { passive: true });

  // The chat drives the core: thinking makes it tremble; first message dims the sign.
  const chatSurface = () => document.querySelector('.chat-surface');
  const observer = new MutationObserver(() => {
    const phase = chatSurface()?.getAttribute('data-chat-phase') || 'idle';
    const was = thinking;
    thinking = phase !== 'idle' && phase !== 'ready';
    if (thinking && !was && !servicesMode) setChatView(true);
    if (document.querySelector('.chat-transcript[data-welcome-only="false"]')) talked = true;
    else showGreetingTop();
  });
  // Keep the terminal above the composer whatever its real height (tools, notice, keyboard).
  const composerEl = document.querySelector('.chat-composer');
  const resize = new ResizeObserver(() => { if (composerEl) document.documentElement.style.setProperty('--deck-composer', `${Math.ceil(composerEl.getBoundingClientRect().height)}px`); });
  if (composerEl) resize.observe(composerEl);
  // Writing in the command line is talking to the chat: bring the terminal near.
  if (composerEl) on(composerEl, 'focusin', () => { if (!focused && !document.documentElement.classList.contains('deck-term-collapsed')) setChatView(true); });
  // While only the greeting is present, show the terminal from its first line.
  function showGreetingTop() { const layer = document.querySelector('.chat-layer'); if (layer && document.querySelector('.chat-transcript[data-welcome-only="true"]')) layer.scrollTop = 0; }
  setTimeout(showGreetingTop, 600); setTimeout(showGreetingTop, 2000);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-chat-phase', 'data-welcome-only'] });

  // ── Terminal anchored in the room ────────────────────────────────────
  // The real chat (React DOM, fully interactive) is projected onto a plane in the
  // scene each frame with a homography, so it sways and keeps perspective with the camera.
  const TERM = { w: 420, head: 34, body: 300, gap: 8 };
  const termPlane = new THREE.Object3D();
  termPlane.position.set(-4.7, 3.85, 1.0); termPlane.rotation.set(-.06, .5, .035); termPlane.scale.setScalar(.0074);
  termPlane.updateMatrixWorld(true);
  const termEls = { head: null, layer: null, latest: null };
  const pv = new THREE.Vector3();
  const proj = (x, y) => { pv.set(x, -y, 0).applyMatrix4(termPlane.matrixWorld).project(camera); return [(pv.x + 1) * .5 * innerWidth, (1 - pv.y) * .5 * innerHeight, pv.z]; };
  function quad(el, x, y, w, h) {
    const q0 = proj(x, y), q1 = proj(x + w, y), q2 = proj(x + w, y + h), q3 = proj(x, y + h);
    if ([q0, q1, q2, q3].some(q => q[2] > 1)) return;
    const [x0, y0] = q0, [x1, y1] = q1, [x2, y2] = q2, [x3, y3] = q3;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1 || 1e-6;
    const g = (dx3 * dy2 - dx2 * dy3) / det, k = (dx1 * dy3 - dx3 * dy1) / det;
    const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
    el.style.transform = `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${x0},${y0},0,1)`;
  }
  function placeTerminal() {
    if (HELIX) return;
    termEls.head ||= document.querySelector('.home-screen .chat-heading');
    termEls.layer ||= document.querySelector('.home-screen .chat-layer');
    termEls.latest = document.querySelector('.home-screen .chat-latest');
    if (termEls.head) quad(termEls.head, 0, 0, TERM.w, TERM.head);
    quad(minBtn, 0, 0, TERM.w, TERM.head);
    if (termEls.layer) quad(termEls.layer, 0, TERM.head, TERM.w, TERM.body);
    if (termEls.latest) quad(termEls.latest, 0, TERM.head + TERM.body + TERM.gap, termEls.latest.offsetWidth || 160, termEls.latest.offsetHeight || 36);
  }
  if (!HELIX) document.documentElement.classList.add('deck-term3d');

  // Minimize: keep only the channel strip so the room can be seen whole.
  const EN = document.documentElement.lang === 'en';
  const minBtn = document.createElement('button');
  minBtn.type = 'button'; minBtn.className = 'deck-term-min';
  minBtn.innerHTML = '<span aria-hidden="true"></span>';
  document.body.append(minBtn);
  const setMin = (min, remember = true) => {
    document.documentElement.classList.toggle('deck-term-collapsed', min);
    minBtn.setAttribute('aria-expanded', String(!min));
    minBtn.setAttribute('aria-label', min ? (EN ? 'Show the chat' : 'Mostrar el chat') : (EN ? 'Minimize the chat' : 'Minimizar el chat'));
    minBtn.title = minBtn.getAttribute('aria-label');
    if (remember) { try { localStorage.setItem('akrasia-term-min', min ? '1' : '0'); } catch { /* ignore */ } }
    if (min) setChatView(false); else if (remember && !servicesMode) setChatView(true);
  };
  let startMin = false; try { startMin = localStorage.getItem('akrasia-term-min') === '1'; } catch { /* ignore */ }
  setMin(startMin, false);
  on(minBtn, 'click', () => { setMin(!document.documentElement.classList.contains('deck-term-collapsed')); sfx.blip?.(700, .06, .03); });
  on(window, 'chat-trigger', () => setMin(false));

  // TX counter and decoding typewriter for replies that arrive in one piece.
  let tx = 0, lastStreamed = 0, typing = null;
  const GLYPHS = 'ΛΔ01<>/#*+=_';
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function typewrite(bubble) {
    const msg = bubble.querySelector('.chat-message'); if (!msg || REDUCE) return;
    const nodes = []; const walk = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (walk.currentNode.nodeValue.trim()) nodes.push({ n: walk.currentNode, text: walk.currentNode.nodeValue });
    const total = nodes.reduce((sum, item) => sum + item.text.length, 0); if (!total) return;
    typing?.finish();
    const start = performance.now(), dur = Math.min(2600, 280 + total * 13);
    let raf = 0;
    const finish = () => { cancelAnimationFrame(raf); nodes.forEach(item => { if (item.n.nodeValue !== item.text) item.n.nodeValue = item.text; }); bubble.classList.remove('deck-decoding'); typing = null; };
    bubble.classList.add('deck-decoding');
    const step = now => {
      const shown = Math.floor(total * Math.min(1, (now - start) / dur)); let left = shown;
      for (const item of nodes) {
        const n = Math.max(0, Math.min(item.text.length, left)); left -= item.text.length;
        let out = item.text.slice(0, n);
        if (n < item.text.length && left < 0 && left > -item.text.length - 1) for (let i = n; i < Math.min(item.text.length, n + 5); i++) out += /\s/.test(item.text[i]) ? item.text[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        item.n.nodeValue = out;
      }
      if (shown < total) raf = requestAnimationFrame(step); else finish();
    };
    typing = { finish }; raf = requestAnimationFrame(step);
  }
  const txObserver = new MutationObserver(records => {
    const surface = chatSurface();
    if (surface?.getAttribute('data-chat-phase') === 'responding') lastStreamed = performance.now();
    for (const r of records) for (const node of r.addedNodes) {
      if (!(node instanceof HTMLElement) || !node.matches('.chat-bubble-agent, .chat-bubble-user')) continue;
      tx++;
      if (node.matches('.chat-bubble-user')) setMin(false);
      const status = document.querySelector('.home-screen .chat-live-status'); status?.setAttribute('data-tx', `TX ${String(tx).padStart(2, '0')}`);
      // Streamed replies already arrived piece by piece; only decode the ones that landed whole.
      const isFinal = node.matches('.chat-bubble-agent') && surface?.getAttribute('data-chat-phase') === 'idle';
      if (isFinal && performance.now() - lastStreamed > 400) typewrite(node);
    }
  });
  const watchTranscript = () => {
    const transcript = document.querySelector('.home-screen .chat-transcript');
    if (!transcript) return setTimeout(watchTranscript, 300);
    txObserver.observe(transcript, { childList: true });
    tx = transcript.querySelectorAll('.chat-bubble-agent, .chat-bubble-user').length || 1;
    document.querySelector('.home-screen .chat-live-status')?.setAttribute('data-tx', `TX ${String(tx).padStart(2, '0')}`);
    const greeting = transcript.querySelector('.chat-bubble-agent'); if (greeting) setTimeout(() => typewrite(greeting), 700);
  };
  watchTranscript();

  // ── Video on demand ───────────────────────────────────────────────────
  // Screens show their cover first. On desktop the clips then load one after another,
  // centre outwards; on phones and slow connections only the screen in front (or the
  // focused one) plays, and at most two clips stay loaded.
  const SLOW_NET = /(^|-)[23]g$/.test(navigator.connection?.effectiveType || '');
  const VIDEO_CAP = MOBILE || HELIX || SLOW_NET ? 2 : Infinity;
  const liveVideos = [];
  function stopVideo(s) {
    const v = s.video; if (!v) return;
    s.video = null; const at = liveVideos.indexOf(s); if (at >= 0) liveVideos.splice(at, 1);
    s.mat.uniforms.map.value = s.mirrorMat.uniforms.map.value = s.still;
    s.vtex?.dispose(); s.vtex = null;
    v.pause(); v.removeAttribute('src'); v.load();
  }
  function startVideo(i, done) {
    const s = screens[i];
    if (!s || !s.item.video || s.video) { done?.(); return; }
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto' });
    v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    s.video = v; liveVideos.push(s);
    let settled = false; const settle = () => { if (!settled) { settled = true; done?.(); } };
    on(v, 'loadeddata', () => {
      if (s.video !== v) return;
      s.vtex = new THREE.VideoTexture(v); s.vtex.colorSpace = THREE.SRGBColorSpace;
      s.mat.uniforms.map.value = s.mirrorMat.uniforms.map.value = s.vtex;
      // Offset each start so fade-to-black endings never coincide.
      try { v.currentTime = (i * 1.7) % Math.max(1, (v.duration || 8) - 1); } catch { /* ignore */ }
      v.play().catch(() => {}); settle();
    }, { once: true });
    on(v, 'error', () => { if (s.video === v) stopVideo(s); settle(); }, { once: true });
    setTimeout(settle, 5000);
    v.src = s.item.video;
    while (liveVideos.length > VIDEO_CAP) stopVideo(liveVideos.find(x => x !== s));
  }
  let wantedVideo = -1;
  if (VIDEO_CAP === Infinity) {
    const mid = (screens.length - 1) / 2;
    const order = screens.map((_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    const next = () => { if (ac.signal.aborted || !order.length) return; startVideo(order.shift(), () => setTimeout(next, 250)); };
    setTimeout(next, 1400);
  }

  // ── Adaptive quality ──────────────────────────────────────────────────
  // If the device can't hold a smooth frame rate, trade sharpness and glow for fluidity:
  // tier 1 renders at fewer pixels, tier 2 also drops the bloom. It never steps back up,
  // so the picture doesn't pump. `?deckq=0|1|2` pins a tier for QA.
  let tier = 0, slowMs = 0, slowFrames = 0, lastStamp = 0;
  const pinned = /[?&]deckq=([012])/.exec(location.search);
  function setTier(n) {
    tier = n;
    const ratio = n === 0 ? FULL_RATIO : Math.min(FULL_RATIO, n === 1 ? 1 : .75);
    renderer.setPixelRatio(ratio); composer.setPixelRatio(ratio); uPx.value = ratio;
    bloom.enabled = n < 2;
    document.documentElement.dataset.deckQuality = String(n);
  }
  if (pinned) setTier(Number(pinned[1]));
  function watchFrameRate(now, boot) {
    const ms = now - lastStamp; lastStamp = now;
    // Skip the boot sequence, tab switches and one-off stalls.
    if (pinned || tier >= 2 || boot < 1 || ms <= 0 || ms > 250) return;
    slowMs += ms;
    if (++slowFrames < 90) return;
    const fps = 1000 / (slowMs / slowFrames); slowMs = 0; slowFrames = 0;
    if (fps < 38) setTier(tier + 1);
  }

  // ── Loop ──────────────────────────────────────────────────────────────
  const bootStart = performance.now();
  // The hint stays until the visitor explores (or long enough to be read).
  const dismissHint = () => $h('.deck-hint')?.classList.add('gone');
  setTimeout(dismissHint, 16000);
  on(canvas, 'pointerdown', dismissHint, { once: true }); on(canvas, 'wheel', dismissHint, { once: true, passive: true });
  function frame() {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    uTime.value = t;
    const boot = THREE.MathUtils.clamp((performance.now() - bootStart - 300) / 2600, 0, 1);
    uBoot.value = boot;
    watchFrameRate(performance.now(), boot);
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
    if (VIDEO_CAP !== Infinity && boot > .5) {
      const want = focused?.kind === 'work' ? focused.index : HELIX ? frontIndex : Math.floor((screens.length - 1) / 2);
      if (want !== wantedVideo) { wantedVideo = want; startVideo(want); }
    }
    screens.forEach((s, i) => {
      const target = (hovered === s.mesh || hovered === s.label || (focused?.kind === 'work' && focused.index === i) || (kbTarget?.kind === 'work' && kbTarget.index === i) || (HELIX && !focused && i === frontIndex && !s.item.placeholder)) ? 1 : 0;
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
      const target = (hovered?.parent === n.g || (focused?.kind === 'service' && focused.index === i) || (kbTarget?.kind === 'service' && kbTarget.index === i)) ? 1 : 0;
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
      chatMix += ((focused ? 0 : chatView) - chatMix) * Math.min(1, dt * 2.2);
      if (chatMix > .001) {
        const k = chatMix * chatMix * (3 - 2 * chatMix);
        desired.pos.lerp(tmpB.copy(CHAT_POSE.pos).add(tmpA.set(parallax.x * .35, parallax.y * .2, 0)), k);
        desired.look.lerp(CHAT_POSE.look, k);
      }
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
    placeTerminal();
    composer.render();
    if (!HELIX) {
      // A colour background would force a clear and wipe the composed frame.
      const bg = scene.background; scene.background = null;
      renderer.autoClear = false; renderer.clearDepth(); camera.layers.set(SIGN_LAYER);
      renderer.render(scene, camera);
      camera.layers.set(0); renderer.autoClear = true; scene.background = bg;
    }
    cssRenderer.render(cssScene, camera);
  }
  renderer.setAnimationLoop(frame);
  on(document, 'visibilitychange', () => { lastStamp = 0; slowMs = 0; slowFrames = 0; renderer.setAnimationLoop(document.hidden ? null : frame); });
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
      ac.abort(); observer.disconnect(); resize.disconnect(); txObserver.disconnect(); typing?.finish();
      document.documentElement.classList.remove('deck-term3d', 'deck-term-collapsed'); minBtn.remove(); Object.values(termEls).forEach(el => el && (el.style.transform = '')); renderer.setAnimationLoop(null); sfx.close();
      screens.forEach(stopVideo);
      disposables.forEach(d => d.dispose?.()); composer.dispose?.(); renderer.dispose();
      root.replaceChildren();
      document.documentElement.classList.remove('deck-focusing', 'deck-helix');
    },
  };
}
