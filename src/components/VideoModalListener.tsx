import { useState, useEffect, useCallback } from 'react';

interface VideoState {
  videoUrl: string;
  title: string;
}

export default function VideoModalListener() {
  const [video, setVideo] = useState<VideoState | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as VideoState;
      if (detail?.videoUrl) setVideo(detail);
    };
    document.addEventListener('video-open', handler);
    return () => document.removeEventListener('video-open', handler);
  }, []);

  const handleClose = useCallback(() => setVideo(null), []);

  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 lg:p-8"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glass-panel overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-sm">
                play_circle
              </span>
              <span className="text-primary text-[10px] font-bold uppercase tracking-widest">
                {video.title}
              </span>
            </div>
            <button
              onClick={handleClose}
              className="w-7 h-7 border border-primary/30 hover:border-primary hover:bg-primary/10 flex items-center justify-center transition-all angular-cut"
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
          <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
            <iframe
              className="absolute inset-0 w-full h-full"
              src={video.videoUrl + '?autoplay=1'}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </div>
  );
}
