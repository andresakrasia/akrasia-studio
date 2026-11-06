import { memo, useEffect, useId, useRef, type CSSProperties } from 'react';
import '../styles/studio-core.css';

export type StudioCorePhase = 'idle' | 'thinking' | 'responding';
export type StudioCoreVariant = 'inline' | 'background';
export interface StudioCoreProps { phase: StudioCorePhase; paused?: boolean; compact?: boolean; variant?: StudioCoreVariant; }
type Point = { x: number; y: number; z: number };
type Projected = { x: number; y: number; z: number };
const FRAME_INTERVAL = 1000 / 30;
const MAX_DPR = 2;
const MAX_DIMENSION = 300;
const MAX_BACKGROUND_DIMENSION = 1000;
const MAX_BACKGROUND_BITMAP = 1600;
const NODE_COUNT = 36;
const SPHERE_STEPS = 36;
const ORBIT_STEPS = 48;
const TAU = Math.PI * 2;
// Fixed coordinates keep the peripheral constellation stable across renders.
const FIELD_NODES = Array.from({ length: 116 }, (_, index) => {
  const x = -175 + (index * 83 % 650), y = -44 + (index * 137 % 388);
  return { x, y, radius: index % 13 === 0 ? 1.05 : index % 5 === 0 ? .7 : .36, bright: index % 13 === 0 };
}).filter(node => Math.hypot(node.x - 150, node.y - 150) > 111);

function orbitPoint(index: number, angle: number): Point {
  const radius = 1.23 + index * .045;
  const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
  const tilt = [.55, -1.02, 1.32][index], turn = [.2, -.7, .82][index];
  const y = -z * Math.sin(tilt), depth = z * Math.cos(tilt);
  return { x: x * Math.cos(turn) - y * Math.sin(turn), y: x * Math.sin(turn) + y * Math.cos(turn), z: depth };
}

function geometry() {
  const circles: Point[][] = [];
  for (let latitude = -3; latitude <= 3; latitude++) {
    const phi = latitude * Math.PI / 9;
    circles.push(Array.from({ length: SPHERE_STEPS }, (_, step) => {
      const theta = step / SPHERE_STEPS * TAU;
      return { x: Math.cos(phi) * Math.cos(theta), y: Math.sin(phi), z: Math.cos(phi) * Math.sin(theta) };
    }));
  }
  for (let meridian = 0; meridian < 10; meridian++) {
    const theta = meridian / 10 * Math.PI;
    circles.push(Array.from({ length: SPHERE_STEPS }, (_, step) => {
      const phi = step / SPHERE_STEPS * TAU;
      return { x: Math.cos(phi) * Math.cos(theta), y: Math.sin(phi), z: Math.cos(phi) * Math.sin(theta) };
    }));
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  const nodes = Array.from({ length: NODE_COUNT }, (_, index) => {
    const y = 1 - 2 * (index + .5) / NODE_COUNT, radius = Math.sqrt(1 - y * y), angle = index * golden;
    return { x: radius * Math.cos(angle), y, z: radius * Math.sin(angle) };
  });
  const links = new Set<string>();
  nodes.forEach((node, index) => {
    nodes.map((other, neighbor) => ({ neighbor, distance: (node.x - other.x) ** 2 + (node.y - other.y) ** 2 + (node.z - other.z) ** 2 }))
      .filter(value => value.neighbor !== index).sort((a, b) => a.distance - b.distance).slice(0, 2)
      .forEach(value => links.add([Math.min(index, value.neighbor), Math.max(index, value.neighbor)].join(':')));
  });
  return { circles, nodes, links: [...links].map(pair => pair.split(':').map(Number)),
    orbits: Array.from({ length: 3 }, (_, index) => Array.from({ length: ORBIT_STEPS }, (_, step) => orbitPoint(index, step / ORBIT_STEPS * TAU))) };
}

function projector(width: number, height: number, angle: number) {
  const centerX = width / 2, centerY = height / 2, scale = Math.min(width, height) * .29;
  const pitch = -.26 + Math.sin(angle * .22) * .12, roll = Math.sin(angle * .17) * .13;
  const sy = Math.sin(angle), cy = Math.cos(angle), sx = Math.sin(pitch), cx = Math.cos(pitch), sz = Math.sin(roll), cz = Math.cos(roll);
  return (point: Point): Projected => {
    const x = point.x * cy + point.z * sy, depth = -point.x * sy + point.z * cy;
    const y = point.y * cx - depth * sx, z = point.y * sx + depth * cx;
    const projectedX = x * cz - y * sz, projectedY = x * sz + y * cz;
    const perspective = 3.6 / (3.6 - z * .62);
    return { x: centerX + projectedX * scale * perspective, y: centerY + projectedY * scale * perspective, z };
  };
}

function StudioCore({ phase, paused = false, compact = false, variant = 'inline' }: StudioCoreProps) {
  const element = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase), pausedRef = useRef(paused), synchronizeRef = useRef<(() => void) | null>(null);
  const variantRef = useRef(variant), resizeRef = useRef<(() => void) | null>(null);
  const id = useId().replace(/[^a-z0-9_-]/giu, '');

  useEffect(() => {
    const variantChanged = variantRef.current !== variant;
    phaseRef.current = phase; pausedRef.current = paused; variantRef.current = variant;
    if (variantChanged) resizeRef.current?.(); else synchronizeRef.current?.();
  }, [phase, paused, variant]);

  useEffect(() => {
    const root = element.current, surface = canvas.current;
    if (!root || !surface) return;
    const context = surface.getContext('2d', { alpha: true });
    if (!context) return;
    const scene = geometry(); // 792 fixed points; no random noise or growing buffers.
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, angle = .42, visible = false;
    let raf: number | undefined, lastPaint: number | undefined, active = true;
    const mayAnimate = () => active && visible && width > 0 && height > 0 && document.visibilityState === 'visible' &&
      !motion.matches && !pausedRef.current && document.documentElement.dataset.hudPaused !== 'true';

    const draw = () => {
      if (!width || !height) return;
      const phaseNow = phaseRef.current, background = variantRef.current === 'background';
      const bright = phaseNow === 'idle' ? (background ? .9 : .72) : phaseNow === 'thinking' ? 1 : .9;
      const minimum = Math.min(width, height), x = width / 2, y = height / 2;
      const strokeScale = background ? Math.max(1, Math.sqrt(minimum / MAX_DIMENSION)) : 1;
      context.clearRect(0, 0, width, height);
      const halo = context.createRadialGradient(x, y, minimum * .08, x, y, minimum * .49);
      halo.addColorStop(0, `rgba(34,116,255,${(background ? .07 : .18) * bright})`);
      halo.addColorStop(.45, `rgba(6,118,197,${(background ? .06 : .15) * bright})`);
      halo.addColorStop(.78, `rgba(26,211,240,${(background ? .035 : .09) * bright})`); halo.addColorStop(1, 'rgba(18,42,90,0)');
      context.fillStyle = halo; context.fillRect(0, 0, width, height);
      const project = projector(width, height, angle), circles = scene.circles.map(circle => circle.map(project));
      for (const front of [false, true]) {
        context.beginPath();
        for (const circle of circles) for (let index = 0; index < circle.length; index++) {
          const a = circle[index], b = circle[(index + 1) % circle.length];
          if ((a.z + b.z > 0) !== front) continue;
          context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
        }
        context.strokeStyle = front ? `rgba(70,231,255,${(background ? .58 : .56) * bright})` : `rgba(38,136,246,${(background ? .21 : .2) * bright})`;
        context.lineWidth = (front ? .75 : .5) * strokeScale; context.stroke();
      }
      const nodes = scene.nodes.map(project);
      context.beginPath();
      for (const [first, second] of scene.links) {
        const a = nodes[first], b = nodes[second];
        if (a.z + b.z < -.4) continue;
        context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
      }
      context.strokeStyle = `rgba(46,157,255,${(background ? .24 : .26) * bright})`; context.lineWidth = .55 * strokeScale; context.stroke();
      scene.orbits.forEach((orbit, index) => {
        const positions = orbit.map(project);
        context.beginPath(); positions.forEach((point, step) => { if (!step) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); });
        context.closePath(); context.lineWidth = (index === 1 ? 1 : .75) * strokeScale;
        context.strokeStyle = [`rgba(71,230,255,${(background ? .51 : .57) * bright})`, `rgba(42,148,255,${(background ? .52 : .58) * bright})`, `rgba(99,211,255,${(background ? .44 : .46) * bright})`][index];
        context.stroke();
        const moving = project(orbitPoint(index, angle * (1 + index * .15) + index * 2.1));
        context.beginPath(); context.arc(moving.x, moving.y, (index === 1 ? 2.2 : 1.7) * strokeScale, 0, TAU);
        context.fillStyle = ['#b1faff', '#82cfff', '#c4edff'][index]; context.fill();
      });
      nodes.forEach((point, index) => {
        if (point.z < -.65) return;
        const radius = (.65 + (point.z + 1) * .55) * strokeScale;
        context.beginPath(); context.arc(point.x, point.y, radius, 0, TAU);
        context.fillStyle = index % 6 === 0 ? '#e0ffff' : `rgba(91,233,255,${(.3 + (point.z + 1) * .3) * bright})`;
        context.fill();
      });
    };

    const stop = () => { if (raf !== undefined) window.cancelAnimationFrame(raf); raf = undefined; lastPaint = undefined; root.dataset.coreMotion = 'still'; };
    const tick = (timestamp: number) => {
      raf = undefined;
      if (!mayAnimate()) { stop(); return; }
      if (lastPaint === undefined || timestamp - lastPaint >= FRAME_INTERVAL) {
        const delta = lastPaint === undefined ? 0 : Math.min((timestamp - lastPaint) / 1000, .1);
        angle += delta * ({ idle: .19, thinking: .64, responding: .39 }[phaseRef.current]);
        lastPaint = timestamp; draw();
      }
      raf = window.requestAnimationFrame(tick);
    };
    const synchronize = () => {
      if (!active) return;
      draw();
      if (!mayAnimate()) { stop(); return; }
      root.dataset.coreMotion = 'running';
      if (raf === undefined) raf = window.requestAnimationFrame(tick);
    };
    const inViewport = () => {
      const bounds = root.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
    };
    const hasIntersectionObserver = typeof IntersectionObserver !== 'undefined';
    const resize = () => {
      const bounds = root.getBoundingClientRect();
      const background = variantRef.current === 'background';
      const maximum = background ? MAX_BACKGROUND_DIMENSION : MAX_DIMENSION;
      const bitmapLimit = background ? MAX_BACKGROUND_BITMAP : MAX_DIMENSION * MAX_DPR;
      const measuredWidth = Math.max(0, bounds.width), measuredHeight = Math.max(0, bounds.height);
      const scale = Math.min(1, maximum / Math.max(1, measuredWidth, measuredHeight));
      width = measuredWidth * scale; height = measuredHeight * scale;
      // Preserve the CSS aspect ratio while capping both fill cost and backing memory.
      const dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1, bitmapLimit / Math.max(1, width, height)));
      surface.width = Math.max(1, Math.min(bitmapLimit, Math.round(width * dpr)));
      surface.height = Math.max(1, Math.min(bitmapLimit, Math.round(height * dpr)));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!hasIntersectionObserver) visible = inViewport();
      synchronize();
    };
    const onScroll = () => { visible = inViewport(); synchronize(); };
    const intersection = hasIntersectionObserver ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.target === root && entry.isIntersecting && entry.intersectionRatio > 0); synchronize();
    }, { threshold: 0 }) : undefined;
    const resizing = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
    const hud = new MutationObserver(synchronize);
    synchronizeRef.current = synchronize; resizeRef.current = resize;
    resize(); intersection?.observe(root); resizing?.observe(root);
    hud.observe(document.documentElement, { attributes: true, attributeFilter: ['data-hud-paused'] });
    document.addEventListener('visibilitychange', synchronize); motion.addEventListener('change', synchronize);
    window.addEventListener('resize', resize);
    if (!hasIntersectionObserver) window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      active = false; stop(); synchronizeRef.current = null; resizeRef.current = null;
      intersection?.disconnect(); resizing?.disconnect(); hud.disconnect();
      document.removeEventListener('visibilitychange', synchronize); motion.removeEventListener('change', synchronize);
      window.removeEventListener('resize', resize); window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return <div ref={element} className={`studio-core${compact ? ' studio-core--compact' : ''}${variant === 'background' ? ' studio-core--background' : ''}`} data-phase={phase} data-variant={variant} data-paused={paused} data-core-motion="still" aria-hidden="true">
    <div className="studio-core__aura" />
    <canvas ref={canvas} className="studio-core__canvas" width={300} height={300} />
    {variant === 'background' && <svg className="studio-core__field" viewBox="-180 -50 660 400" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-field-spectrum`} x1="-180" y1="-50" x2="480" y2="350" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4be5f5" stopOpacity=".32" /><stop offset=".48" stopColor="#5beeff" stopOpacity=".7" /><stop offset="1" stopColor="#418fe8" stopOpacity=".38" />
        </linearGradient>
      </defs>
      <g className="studio-core__field-orbits" stroke={`url(#${id}-field-spectrum)`} strokeWidth=".4">
        <circle cx="150" cy="150" r="155" strokeDasharray="92 33 16 58 68 104" transform="rotate(17 150 150)" />
        <circle cx="150" cy="150" r="163" strokeDasharray="1 11" />
        <path d="M-16 117a169 169 0 0 1 79-112M241 7a169 169 0 0 1 67 78M302 231a169 169 0 0 1-130 87M-9 209a169 169 0 0 0 49 67" />
        <path d="M46 12 59 4h14M249 15l12 10v14M287 263l-11 13h-15M6 240l-9-13v-13" strokeWidth="1.1" />
      </g>
      <g className="studio-core__field-circuits" stroke={`url(#${id}-field-spectrum)`} strokeWidth=".45" strokeLinejoin="round">
        <path d="M52 82 27 57h-49l-24-24h-64l-17-17h-49M38 116H-8l-20-20h-91l-23-23h-34M26 151h-72l-24 24h-65l-20-20h-21M44 219l-28 28h-47l-20 20h-57l-22 22h-46M86 257l-26 26H5l-20 20h-89l-21 21h-71" />
        <path d="M248 82l25-25h49l24-24h64l17-17h49M262 116h46l20-20h91l23-23h34M274 151h72l24 24h65l20-20h21M256 219l28 28h47l20 20h57l22 22h46M214 257l26 26h55l20 20h89l21 21h51" />
        <path d="M-176 43h56l12 12h32M-176 47h51l12 12h30M-176 217h38l12-12h51M-176 221h42l12-12h38M476 43h-56l-12 12h-32M476 47h-51l-12 12h-30M476 217h-38l-12-12h-51M476 221h-42l-12-12h-38" strokeOpacity=".55" />
        <path d="M103 18 84-1H47L31-17H-31M197 18l19-19h37l16-16h62M106 282l-19 19H48l-16 16h-63M194 282l19 19h39l16 16h63" strokeOpacity=".6" />
      </g>
      <g className="studio-core__field-terminals" stroke="#a0f8ff" strokeWidth=".5">
        {[[52, 82], [38, 116], [26, 151], [44, 219], [86, 257], [248, 82], [262, 116], [274, 151], [256, 219], [214, 257]].map(([x, y], index) => <g key={index}>
          <circle cx={x} cy={y} r="1.8" /><circle cx={x} cy={y} r=".65" fill="#c6fcff" stroke="none" />
        </g>)}
        <path d="M-167 16h17M-167 73h12M-167 155h17M-167 289h12M467 16h-17M467 73h-12M467 155h-17M467 289h-12" />
      </g>
      <g className="studio-core__field-reticles" stroke="#65dff7" strokeWidth=".45">
        <g transform="translate(-90 126)">
          <circle r="23" strokeOpacity=".35" /><circle r="18" strokeDasharray="18 12 8 24" /><circle r="12" strokeOpacity=".3" />
          <path d="M-27-7v-10l9-9h11M27 7v10l-9 9H7M-29 0h11M18 0h11M0-29v11M0 18v11M-4 0h8M0-4v8" />
          <circle r="2" fill="#81f5ff" stroke="none" />
        </g>
        <g transform="translate(390 237)">
          <circle r="28" strokeOpacity=".3" /><circle r="22" strokeDasharray="32 15 12 35" /><circle r="15" strokeOpacity=".45" />
          <path d="M-33-7v-11l11-11h12M33 7v11l-11 11H10M-34 0h12M22 0h12M0-34v12M0 22v12M-4 0h8M0-4v8" />
          <circle r="2" fill="#81f5ff" stroke="none" />
        </g>
      </g>
      <g className="studio-core__field-stars">
        {FIELD_NODES.map(({ x, y, radius, bright }, index) => <g key={index}>
          {radius > .36 && <circle cx={x} cy={y} r={radius * 3.6} fill="#31dbff" fillOpacity={bright ? '.12' : '.065'} />}
          <circle cx={x} cy={y} r={radius} fill={bright ? '#a3faff' : '#56d9ff'} fillOpacity={bright ? '.85' : '.5'} />
        </g>)}
      </g>
    </svg>}
    <svg className="studio-core__projection" viewBox="0 0 300 300" fill="none" focusable="false">
      <defs>
        <linearGradient id={`${id}-core-spectrum`} x1="60" y1="60" x2="240" y2="255" gradientUnits="userSpaceOnUse">
          <stop stopColor="#74faff" /><stop offset=".48" stopColor="#398bff" /><stop offset="1" stopColor="#7ad8ff" />
        </linearGradient>
        <radialGradient id={`${id}-core-center`}><stop stopColor="#081a38" stopOpacity=".85" /><stop offset="1" stopColor="#041222" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="studio-core__perimeter" stroke={`url(#${id}-core-spectrum)`}>
        <circle cx="150" cy="150" r="133" strokeWidth=".6" strokeDasharray="1 7" />
        <circle cx="150" cy="150" r="126" strokeWidth="1.15" strokeDasharray="46 28 15 105" />
        {Array.from({ length: 24 }, (_, index) => {
          const angle = index / 24 * TAU;
          return <path key={index} d={`M${150 + Math.cos(angle) * 139} ${150 + Math.sin(angle) * 139}L${150 + Math.cos(angle) * (index % 3 === 0 ? 145 : 142)} ${150 + Math.sin(angle) * (index % 3 === 0 ? 145 : 142)}`} strokeWidth={index % 3 === 0 ? 1.4 : .65} />;
        })}
        <path d="M35 90V67H58M242 67h23v23M35 210v23h23M242 233h23v-23" strokeWidth="1" />
      </g>
      {variant === 'background' && <g className="studio-core__calibration" stroke="#a0eaff" strokeWidth=".4">
        <circle cx="150" cy="150" r="112" strokeDasharray=".6 3.8" />
        <circle cx="150" cy="150" r="119" strokeDasharray="27 68 44 52" transform="rotate(-24 150 150)" />
        <circle cx="150" cy="150" r="143" strokeDasharray="58 146 32 88" transform="rotate(12 150 150)" />
        {Array.from({ length: 72 }, (_, index) => {
          const angle = index / 72 * TAU;
          const major = index % 6 === 0;
          return <path key={index} d={`M${150 + Math.cos(angle) * 114} ${150 + Math.sin(angle) * 114}L${150 + Math.cos(angle) * (major ? 118 : 116)} ${150 + Math.sin(angle) * (major ? 118 : 116)}`} strokeWidth={major ? .65 : .3} />;
        })}
        <g className="studio-core__traces">
          <path d="M52 82 35 65H13M248 82l17-17h22M49 219l-16 16H13M251 219l16 16h20" />
          <path d="M150 24V9m-4 0h8M150 276v15m-4 0h8M24 150H9m0-4v8M276 150h15m0-4v8" />
          <circle cx="52" cy="82" r="1.6" /><circle cx="248" cy="82" r="1.6" />
          <circle cx="49" cy="219" r="1.6" /><circle cx="251" cy="219" r="1.6" />
          <path d="M13 62v6M287 62v6M13 232v6M287 232v6" />
        </g>
      </g>}
      <circle cx="150" cy="150" r="39" fill={`url(#${id}-core-center)`} />
      {variant !== 'background' && <g className="studio-core__emblem">
        <path d="m132 169 18-41 18 41" stroke={`url(#${id}-core-spectrum)`} strokeWidth="3" strokeLinecap="square" />
        <path d="m137 172 13-30 13 30M141 178h18" stroke="#d5ffff" strokeWidth=".85" strokeLinecap="square" />
        <circle cx="150" cy="121" r="1.5" fill="#c4faff" />
      </g>}
    </svg>
    {variant === 'background' && <div className="studio-core__brand font-headline" aria-hidden="true">
      <span className="hud-brand-wordmark">
        {['Λ', 'K', 'R', 'Λ', 'S', 'I', 'Λ'].map((glyph, index) => <span key={index}
          className="studio-core__brand-char neon-char" style={{
            fontSize: `${[.7, .84, .98, 1.12, .98, .84, .7][index]}em`, letterSpacing: '-.05em',
            '--neon-delay': `${[0, .3, .7, 1.1, .5, .9, 1.4][index]}s`,
            '--neon-dur': `${[4.2, 3.8, 4.5, 3.5, 4.8, 3.9, 4.1][index]}s`,
          } as CSSProperties}>{glyph}</span>)}
      </span>
      <span className="hud-brand-subtitle neon-sub">STUDIO</span>
    </div>}
  </div>;
}

export default memo(StudioCore);
