import type { APIRoute } from 'astro';
import { PUBLIC_PROJECT_CACHE_HEADERS } from '../lib/public-projects';
import { getPublicProjects } from '../lib/public-projects';
import { loadPublicServices } from '../lib/public-content';
import { publicCanonical } from '../lib/public-ui';
import { serviceHasEnglish, serviceIsIndexable, projectHasEnglish, projectIsIndexable } from '../lib/public-seo';

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async () => {
  let services, projects;
  try {
    [services, projects] = await Promise.all([loadPublicServices(), getPublicProjects()]);
  } catch {
    return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<error>Public catalogue temporarily unavailable</error>', {
      status: 503, headers: { ...PUBLIC_PROJECT_CACHE_HEADERS, 'Content-Type': 'application/xml; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Retry-After': '60' },
    });
  }
  const urls: string[] = [];
  const add = (path: string, bilingual = true) => {
    const languages = bilingual ? ['es', 'en'] as const : ['es'] as const;
    for (const lang of languages) {
      const alternates = bilingual ? ['es', 'en', 'x-default'].map(language =>
        `    <xhtml:link rel="alternate" hreflang="${language}" href="${escapeXml(publicCanonical(path, language === 'en' ? 'en' : 'es'))}" />`).join('\n') : '';
      urls.push(`  <url>\n    <loc>${escapeXml(publicCanonical(path, lang))}</loc>${alternates ? '\n' + alternates : ''}\n  </url>`);
    }
  };
  add('/');
  if (services.length > 0) add('/servicios');
  if (projects.length > 0) add('/proyectos');
  add('/contacto');
  for (const service of services) if (serviceIsIndexable(service)) add(`/servicios/${service.slug}`, serviceHasEnglish(service));
  for (const project of projects) if (projectIsIndexable(project)) add(`/proyectos/${project.slug}`, projectHasEnglish(project));
  for (const path of ['/aviso-legal', '/privacidad', '/cookies']) add(path, false);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>`;
  return new Response(xml, { headers: { ...PUBLIC_PROJECT_CACHE_HEADERS, 'Content-Type': 'application/xml; charset=utf-8' } });
};

