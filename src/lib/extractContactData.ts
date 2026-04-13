const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const PHONE_RE = /(?:(?:\+34|0034)\s?)?(?:6[0-9]{2}|7[0-9]{2}|9[0-9]{2})(?:[\s.\-]?[0-9]{3}){2}|\+\d{1,3}[\s.\-]?\d{2,4}[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/g;

const PROJECT_TYPE_KEYWORDS: Record<string, string[]> = {
  spot: ['spot', 'publicidad', 'anuncio', 'comercial', 'ad'],
  videoclip: ['videoclip', 'video musical', 'video musical', 'clip', 'musica', 'cantante', 'artista'],
  branded: ['branded', 'contenido de marca', 'brand content', 'contenido patrocinado'],
  fashion: ['fashion', 'moda', 'fashion film', 'pasarela', 'colección'],
  corto: ['corto', 'cortometraje', 'experimental', 'narrativo'],
  documental: ['documental', 'docu', 'reportaje'],
  instalacion: ['instalacion', 'inmersiva', 'exposicion', 'museo'],
  corporativo: ['corporativo', 'empresa', 'branding', 'imagen de marca'],
};

export interface ExtractedData {
  emails: string[];
  phones: string[];
  projectType: string | null;
}

export function extractContactData(text: string): ExtractedData {
  const emailMatches = text.match(EMAIL_RE) || [];
  const phoneMatches = text.match(PHONE_RE) || [];

  const lower = text.toLowerCase();
  let projectType: string | null = null;
  for (const [type, keywords] of Object.entries(PROJECT_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      projectType = type;
      break;
    }
  }

  return {
    emails: [...new Set(emailMatches)],
    phones: [...new Set(phoneMatches.map((p) => p.trim()))],
    projectType,
  };
}
