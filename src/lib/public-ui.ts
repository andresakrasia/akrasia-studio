export type PublicLang = 'es' | 'en';
/** A URL is the language authority: the same URL always renders the same locale. */
export function pageLang(url: URL): PublicLang {
  return url.searchParams.get('lang') === 'en' ? 'en' : 'es';
}
export function languagePath(path: string, lang: PublicLang): string {
  const url = new URL(path, 'https://akrasia.studio');
  url.search = '';
  if (lang === 'en') url.searchParams.set('lang', 'en');
  return `${url.pathname}${url.search}${url.hash}`;
}
export function alternateLanguagePath(url: URL, lang: PublicLang): string {
  return languagePath(`${url.pathname}${url.hash}`, lang === 'es' ? 'en' : 'es');
}
export function publicCanonical(path: string, lang: PublicLang): string {
  return new URL(languagePath(path, lang), 'https://akrasia.studio').href;
}
