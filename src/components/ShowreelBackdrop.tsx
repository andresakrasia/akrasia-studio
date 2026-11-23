import { useEffect, useRef, useState } from 'react';
import { showreelSources } from '../lib/showreel';

/**
 * Muted, looping showreel behind the conversation while the visitor has not
 * started talking. Sources come from PUBLIC_SHOWREEL (comma-separated, local
 * paths or HTTPS); without it nothing is rendered. Reduced motion and the hub
 * pause control keep it still.
 */
export default function ShowreelBackdrop({ active, paused }: { active: boolean; paused: boolean }) {
  const sources = showreelSources(import.meta.env.PUBLIC_SHOWREEL);
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const still = reduced || paused || !active;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (still) element.pause();
    else void element.play().catch(() => undefined);
  }, [still, index]);

  if (sources.length === 0) return null;
  return <div className="studio-showreel" data-active={active} data-ready={ready} aria-hidden="true">
    <video ref={video} key={sources[index]} src={sources[index]} muted playsInline preload="metadata" tabIndex={-1}
      autoPlay={!still} loop={sources.length === 1}
      onLoadedData={() => setReady(true)}
      onEnded={() => setIndex(current => (current + 1) % sources.length)} />
    <span className="studio-showreel__grade" />
    <span className="studio-showreel__scan" />
    <span className="studio-showreel__label">SHOWREEL</span>
  </div>;
}
