import { useState, useEffect, useCallback, useRef } from 'react';
import { externalVideoEmbed, hasExternalMediaConsent, openPrivacySettings, PRIVACY_CHANGE_EVENT } from '../lib/privacy-consent';
import { getLang } from '../lib/i18n';
import '../styles/studio-hologram-video.css';

interface VideoState {
  id: string;
  videoUrl: string;
  title: string;
}

function safeVideoURL(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

export default function VideoModalListener() {
  const [video, setVideo] = useState<VideoState | null>(null);
  const [mediaAllowed, setMediaAllowed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const english = getLang() === 'en';

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as VideoState;
      if (safeVideoURL(detail?.videoUrl) && typeof detail.title === 'string' && typeof detail.id === 'string') {
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setMediaAllowed(hasExternalMediaConsent()); setVideo(detail);
      }
    };
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>('[data-video-open]');
      if (!trigger) return;
      if (!safeVideoURL(trigger.dataset.projectVideo)) return;
      event.preventDefault();
      handler(new CustomEvent('video-open', { detail: { id: trigger.dataset.projectId, videoUrl: trigger.dataset.projectVideo, title: trigger.dataset.projectTitle } }));
    };
    const refresh = (event: Event) => {
      const ids = (event as CustomEvent<{ ids: string[] }>).detail.ids;
      setVideo((current) => current && ids.includes(current.id) ? current : null);
    };
    document.addEventListener('video-open', handler);
    document.addEventListener('click', click);
    document.addEventListener('portfolio-refresh', refresh);
    const consent = () => setMediaAllowed(hasExternalMediaConsent());
    window.addEventListener(PRIVACY_CHANGE_EVENT, consent);
    return () => {
      document.removeEventListener('video-open', handler);
      document.removeEventListener('click', click);
      document.removeEventListener('portfolio-refresh', refresh);
      window.removeEventListener(PRIVACY_CHANGE_EVENT, consent);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (video && dialog && !dialog.open) dialog.showModal();
  }, [video]);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    setVideo(null);
    openerRef.current?.focus();
  }, []);

  if (!video) return null;
  const embed = externalVideoEmbed(video.videoUrl);
  const youtubePage = embed?.provider === 'YouTube'
    ? `https://www.youtube.com/watch?v=${new URL(embed.src).pathname.slice('/embed/'.length)}` : '';

  return (
    <dialog ref={dialogRef} aria-labelledby="videoDialogTitle" onCancel={event => { event.preventDefault(); handleClose(); }}
      className="studio-hologram-dialog fixed inset-0 z-[200] w-full max-w-4xl m-auto text-slate-200">
      <div
        className="studio-hologram-video-shell relative z-10 w-full max-w-4xl"
      >
        <div className="studio-hologram-video-surface glass-panel overflow-hidden" data-video-provider={embed?.provider}>
          <div className="studio-hologram-video-header flex items-center justify-between p-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span id="videoDialogTitle" className="text-primary text-[10px] font-bold uppercase tracking-widest">
                {video.title}
              </span>
            </div>
            <div className="studio-hologram-video-header-actions">
            {youtubePage && <a className="studio-hologram-video-provider-link" href={youtubePage} target="_blank" rel="noopener noreferrer"
              aria-label={english ? 'Watch on YouTube' : 'Ver en YouTube'}>YouTube <span aria-hidden="true">↗</span></a>}
            <button
              onClick={handleClose}
              type="button"
              aria-label={english ? 'Close video' : 'Cerrar vídeo'}
              className="studio-hologram-video-close w-11 h-11 shrink-0 border border-primary/30 hover:border-primary hover:bg-primary/10 flex items-center justify-center transition-all angular-cut"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className="stroke-primary/60 hover:stroke-primary transition-colors"
              >
                <line x1="1" y1="1" x2="11" y2="11" strokeWidth="1.5" />
                <line x1="11" y1="1" x2="1" y2="11" strokeWidth="1.5" />
              </svg>
            </button>
            </div>
          </div>
          {embed && mediaAllowed ? <div className="studio-hologram-video-frame relative w-full" style={{ paddingTop: '56.25%' }}>
            <iframe
              className="absolute inset-0 w-full h-full"
              src={embed.src}
              title={video.title}
              referrerPolicy={embed.provider === 'YouTube' ? 'strict-origin-when-cross-origin' : 'no-referrer'}
              allow="autoplay; encrypted-media; picture-in-picture"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allowFullScreen
            />
          </div> : <div className="p-6 text-sm leading-relaxed">
            {embed ? <>
              <p>{english ? `This video is played by ${embed.provider}. Allow external media to load it. The provider will receive connection data.` : `Este vídeo se reproduce mediante ${embed.provider}. Para cargarlo, permite los vídeos externos. El proveedor recibirá datos de conexión.`} <a className="underline text-primary" href="/cookies">{english ? 'Cookie information (Spanish)' : 'Información de cookies'}</a>.</p>
              <button type="button" onClick={openPrivacySettings} className="mt-4 px-4 py-3 border border-primary text-primary">{english ? 'Configure external videos' : 'Configurar vídeos externos'}</button>
            </> : <p>{english ? 'This video has no enabled external player. ' : 'Este vídeo no dispone de un reproductor externo habilitado. '}<a className="underline" href={video.videoUrl} target="_blank" rel="noopener noreferrer">{english ? 'Visit the video provider' : 'Visitar el proveedor del vídeo'}</a></p>}
          </div>}
        </div>
        <div className="studio-hologram-video-pedestal" aria-hidden="true" />
      </div>
    </dialog>
  );
}
