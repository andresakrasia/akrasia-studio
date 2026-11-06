/** Only public, consented activity is measurable. Never pass conversation data here. */
export interface AnalyticsOptions {
  analyticsEnabled: boolean;
  containerId: string;
  measurementId?: string;
  ga4Reviewed?: boolean;
}
export type AnalyticsDestination = { kind: 'ga4' | 'gtm'; id: string };
export const ANALYTICS_COOKIE_SECONDS = 180 * 24 * 60 * 60;
export const ANALYTICS_SCRIPT_ID = 'akrasia-consented-analytics';

/** A reviewed but invalid GA4 destination must not silently select another account. */
export function analyticsDestination(options: AnalyticsOptions): AnalyticsDestination | null {
  if (options.ga4Reviewed) return /^G-[A-Z0-9]{4,20}$/.test(options.measurementId || '')
    ? { kind: 'ga4', id: options.measurementId! } : null;
  return options.analyticsEnabled && /^GTM-[A-Z0-9]{4,20}$/.test(options.containerId)
    ? { kind: 'gtm', id: options.containerId } : null;
}

export function analyticsOptionsFromEnv(env: {
  PUBLIC_GA4_MEASUREMENT_ID?: string; PUBLIC_GA4_REVIEWED?: string;
  PUBLIC_GTM_CONTAINER_ID?: string; PUBLIC_GTM_CONTAINER_REVIEWED?: string;
}): AnalyticsOptions {
  return {
    analyticsEnabled: env.PUBLIC_GTM_CONTAINER_REVIEWED === 'true',
    containerId: env.PUBLIC_GTM_CONTAINER_ID || '',
    measurementId: env.PUBLIC_GA4_MEASUREMENT_ID || '',
    ga4Reviewed: env.PUBLIC_GA4_REVIEWED === 'true',
  };
}

/** Preserve a canonical public path and language, stripping free queries and fragments. */
export function analyticsPageLocation(value: string): string {
  try {
    const url = new URL(value, 'https://akrasia.studio');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !/^\/(?:|contacto\/?|cookies\/?|privacidad\/?|aviso-legal\/?|(?:servicios|proyectos)(?:\/[a-z0-9-]{1,120})?\/?)$/.test(url.pathname)) {
      return 'https://akrasia.studio/';
    }
    const english = url.searchParams.get('lang') === 'en';
    url.search = ''; url.hash = '';
    if (english) url.searchParams.set('lang', 'en');
    return url.href;
  } catch { return 'https://akrasia.studio/'; }
}

export type PublicAnalyticsEvent = 'chat_start' | 'booking_confirmed';
export interface PublicAnalyticsParameters { language: 'es' | 'en'; }
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; [key: `ga-disable-${string}`]: boolean | undefined };
let activeEventSink: ((event: PublicAnalyticsEvent, language: 'es' | 'en') => void) | null = null;

/** Closed event and parameter allowlists: text, emails, tokens and visitor/booking IDs have no API. */
export function trackPublicEvent(event: PublicAnalyticsEvent, parameters: PublicAnalyticsParameters): void {
  if (!['chat_start', 'booking_confirmed'].includes(event) || !parameters ||
    !['es', 'en'].includes(parameters.language) || Object.keys(parameters).some(key => key !== 'language')) return;
  activeEventSink?.(event, parameters.language);
}

export function createAnalyticsSession(destination: AnalyticsDestination, environment: { win: Window; doc: Document },
  hasConsent: () => boolean): { start: () => void; stop: () => void } {
  const { doc } = environment;
  const target = environment.win as AnalyticsWindow;
  let started = false;
  let stopped = false;
  const page = () => {
    const canonical = doc.querySelector?.('link[rel="canonical"]')?.getAttribute('href');
    return analyticsPageLocation(canonical || target.location.href || `https://akrasia.studio${target.location.pathname}`);
  };
  const parameters = (language: 'es' | 'en') => ({
    page_location: page(), page_referrer: '', page_title: 'AKRASIA STUDIO', language,
  });
  const emit = (event: 'page_view' | PublicAnalyticsEvent, language: 'es' | 'en') => {
    if (!started || stopped || !hasConsent() || /^\/dashboard(?:\/|$)/.test(target.location.pathname)) return;
    const safe = parameters(language);
    if (destination.kind === 'ga4') target.gtag?.('event', event, { ...safe, send_to: destination.id });
    else target.dataLayer?.push({ event: `akrasia_${event}`, ...safe });
  };
  const sink = (event: PublicAnalyticsEvent, language: 'es' | 'en') => emit(event, language);
  return {
    start() {
      if (started || stopped || !hasConsent() || /^\/dashboard(?:\/|$)/.test(target.location.pathname)) return;
      started = true;
      activeEventSink = sink;
      target.dataLayer = target.dataLayer || [];
      const script = doc.createElement('script');
      script.id = ANALYTICS_SCRIPT_ID; script.async = true; script.referrerPolicy = 'no-referrer';
      if (destination.kind === 'ga4') {
        target[`ga-disable-${destination.id}`] = false;
        target.gtag = function (..._args: unknown[]) { target.dataLayer?.push(arguments); };
        // These commands are queued only AFTER an explicit, current acceptance.
        target.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied',
          ad_user_data: 'denied', ad_personalization: 'denied' });
        const settings = { allow_google_signals: false, allow_ad_personalization_signals: false,
          send_page_view: false, ...parameters(doc.documentElement?.lang === 'en' ? 'en' : 'es'),
          cookie_expires: ANALYTICS_COOKIE_SECONDS, cookie_update: false };
        target.gtag('set', settings);
        target.gtag('js', new Date());
        target.gtag('config', destination.id, settings);
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(destination.id)}`;
      } else {
        target.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
        script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(destination.id)}`;
      }
      emit('page_view', doc.documentElement?.lang === 'en' ? 'en' : 'es');
      doc.head.append(script);
    },
    stop() {
      stopped = true;
      if (activeEventSink === sink) activeEventSink = null;
      if (destination.kind === 'ga4') {
        target[`ga-disable-${destination.id}`] = true;
        delete target.gtag;
      }
      // Revoked queued events must not be dispatched by an asynchronously loading tag.
      target.dataLayer?.splice(0);
      doc.getElementById(ANALYTICS_SCRIPT_ID)?.remove();
    },
  };
}
