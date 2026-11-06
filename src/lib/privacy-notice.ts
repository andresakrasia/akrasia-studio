// Public identity supplied by the site owner on 2026-10-02. These values do not
// claim a registry, tax or contract verification. Never put service keys here.
export const PRIVACY_NOTICE = {
  updatedAt: '2026-10-02',
  updatedLabel: '2 de octubre de 2026',
  commercialName: 'AKRASIA STUDIO',
  controller: 'Andrés Gómez Martínez',
  nif: '39418645A',
  address: 'Bonaventura Polles 28, 08014 Barcelona',
  email: 'info@akrasia.studio',
  phone: '+34 637 26 40 41',
} as const;

export const PRIVACY_SOURCES = {
  gdpr: 'https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807',
  spanishDataProtection: 'https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673',
  lssi: 'https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758',
  cookies: 'https://www.aepd.es/guias/guia-cookies.pdf',
  rights: 'https://www.aepd.es/derechos-y-deberes/ejerce-tus-derechos',
  complaints: 'https://www.aepd.es/derechos-y-deberes/conoce-tus-derechos',
} as const;

// Read only the public duration; legal pages must remain available even when
// chat credentials or its store are unavailable. Match CHAT_SESSION_SECONDS.
export function publicChatSessionSeconds(env: Record<string, unknown>): number | null {
  const value = env.CHAT_SESSION_SECONDS;
  if (value === undefined || value === '') return 86400;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 2592000 ? seconds : null;
}

export function durationLabel(seconds: number | null): string {
  if (seconds === null) return 'Configuración no disponible: consulta al responsable';
  if (seconds % 86400 === 0) return `${seconds / 86400} ${seconds === 86400 ? 'día' : 'días'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} ${seconds === 3600 ? 'hora' : 'horas'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minutos`;
  return `${seconds} segundos`;
}
