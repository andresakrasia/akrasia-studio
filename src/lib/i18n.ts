type Lang = 'es' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  'header.engine': { es: 'ENGINE: ACTIVE', en: 'ENGINE: ACTIVE' },
  'header.studio': { es: 'STUDIO: ONLINE', en: 'STUDIO: ONLINE' },
  'header.session': { es: 'SESSION: VISITOR', en: 'SESSION: VISITOR' },
  'header.live': { es: 'EN DIRECTO', en: 'LIVE' },
  'header.cta': { es: 'Iniciar Proyecto', en: 'Start Project' },
  'header.chatTrigger': { es: 'Hola, quiero saber más sobre Akrasia Studio', en: 'Hi, I want to know more about Akrasia Studio' },

  'footer.manifiesto': { es: 'Manifiesto', en: 'Manifesto' },
  'footer.proyectos': { es: 'Proyectos', en: 'Projects' },
  'footer.contacto': { es: 'Contacto', en: 'Contact' },
  'footer.manifiestoMsg': { es: 'Quiero conocer vuestro manifiesto, qué es lo que os define como estudio', en: 'I want to know your manifesto, what defines you as a studio' },
  'footer.proyectosMsg': { es: 'Quiero ver vuestros proyectos, qué tipo de trabajos hacéis', en: 'I want to see your projects, what kind of work do you do' },
  'footer.contactoMsg': { es: 'Quiero contactar con vosotros', en: 'I want to contact you' },

  'center.subtitle': { es: 'Productora audiovisual de nueva generación. Profesionales del sector.\n          Tecnologia sin limites.', en: 'Next-generation audiovisual production. Industry professionals.\n          Technology without limits.' },
  'center.location': { es: 'UBICACION', en: 'LOCATION' },
  'center.mode': { es: 'MODO', en: 'MODE' },
  'center.modeVal': { es: 'STUDIO', en: 'STUDIO' },
  'center.locationVal': { es: 'BARCELONA', en: 'BARCELONA' },

  'left.about': { es: 'Sobre_Nosotros', en: 'About_Us' },
  'left.aboutText': { es: 'No somos una agencia de prompts.\nSomos directores, creadores y productores\nque han convertido la IA en su ventaja definitiva.', en: "We're not a prompt agency.\nWe're directors, creators and producers\nwho have made AI their definitive advantage." },
  'left.aboutTagline': { es: 'Hacemos lo que antes no era posible.', en: 'We do what wasn\'t possible before.' },
  'left.services': { es: 'Servicios', en: 'Services' },
  'left.status': { es: 'Studio_Status', en: 'Studio_Status' },
  'left.projects': { es: 'Proyectos en curso', en: 'Active projects' },
  'left.pieces': { es: 'Piezas entregadas', en: 'Pieces delivered' },
  'left.clients': { es: 'Clientes activos', en: 'Active clients' },
  'left.feed': { es: 'AI_Generation_Live', en: 'AI_Generation_Live' },
  'left.noFeed': { es: 'Sin actividad reciente', en: 'No recent activity' },

  'right.portfolio': { es: 'Portfolio_Reciente', en: 'Recent_Portfolio' },
  'right.works': { es: 'Trabajos', en: 'Work' },
  'right.logs': { es: 'Estudio_Logs', en: 'Studio_Logs' },
  'right.progress': { es: 'Progreso', en: 'Progress' },
  'right.tasks': { es: 'tareas', en: 'tasks' },

  'status.planning': { es: 'Planificación', en: 'Planning' },
  'status.in_production': { es: 'En producción', en: 'In production' },
  'status.post_production': { es: 'Post-producción', en: 'Post-production' },
  'status.completed': { es: 'Completado', en: 'Completed' },
  'status.delivered': { es: 'Entregado', en: 'Delivered' },

  'log.ready': { es: 'LISTO:', en: 'READY:' },
  'log.warn': { es: 'AVISO:', en: 'WARN:' },
  'log.core': { es: 'CORE:', en: 'CORE:' },

  'chat.agent': { es: 'AGENTE_AKRASIA', en: 'AGENT_AKRASIA' },
  'chat.you': { es: 'TU', en: 'YOU' },
  'chat.typing': { es: 'Escribiendo...', en: 'Typing...' },
  'chat.placeholder': { es: 'Escribe tu mensaje al agente AKRASIA...', en: 'Type your message to AKRASIA agent...' },
  'chat.placeholderMobile': { es: 'Escribe tu mensaje...', en: 'Type your message...' },
  'chat.send': { es: 'Enviar', en: 'Send' },
  'chat.bookCall': { es: 'Reservar llamada', en: 'Book a call' },
  'chat.bookCallMsg': { es: 'Me gustaría reservar una llamada de 30 minutos para hablar de mi proyecto', en: 'I\'d like to book a 30-minute call to discuss my project' },
  'chat.hint': { es: 'Agente disponible — Haz click para chatear', en: 'Agent available — Click to chat' },
  'chat.hintMsg': { es: 'Hola, quiero saber más sobre Akrasia Studio', en: 'Hi, I want to know more about Akrasia Studio' },
  'chat.welcome': { es: 'Cuéntame qué quieres contar —un spot, un videoclip, contenido para redes o algo que aún no tiene nombre— y te explico cómo lo produciríamos.', en: 'Tell me what you want to make —an ad, a music video, social content or something that doesn\'t have a name yet— and I\'ll walk you through how we would produce it.' },
  'chat.error': { es: 'Lo siento, ha ocurrido un error de conexión. Intenta de nuevo en unos momentos.', en: 'Sorry, a connection error occurred. Please try again in a moment.' },
  'chat.rateLimited': { es: 'El chat ha alcanzado su límite de uso. Tu mensaje no se ha procesado. Inténtalo cuando termine la espera.', en: 'The chat has reached its usage limit. Your message was not processed. Try again after the wait.' },
  'chat.busy': { es: 'El chat está atendiendo otras consultas. Tu mensaje no se ha procesado. Inténtalo de nuevo en unos momentos.', en: 'The chat is handling other questions. Your message was not processed. Try again in a moment.' },
  'chat.unavailable': { es: 'El chat no está disponible temporalmente. Inténtalo de nuevo en unos momentos.', en: 'The chat is temporarily unavailable. Please try again in a moment.' },
  'chat.timeout': { es: 'La respuesta ha tardado demasiado y se ha detenido. Inténtalo de nuevo en unos momentos.', en: 'The response took too long and was stopped. Please try again in a moment.' },
  'chat.interrupted': { es: 'La respuesta se ha interrumpido antes de completarse. No podemos confirmar que la consulta haya terminado. Comprueba tu conexión e inténtalo de nuevo.', en: 'The response was interrupted before it finished. We cannot confirm that the request completed. Check your connection and try again.' },
  'chat.tooLarge': { es: 'El mensaje es demasiado largo. Divídelo en partes de hasta 2000 caracteres y vuelve a enviarlo.', en: 'The message is too long. Split it into parts of up to 2000 characters and send it again.' },
  'chat.invalidRequest': { es: 'No se ha podido enviar el mensaje. Escribe una consulta breve e inténtalo de nuevo.', en: 'The message could not be sent. Write a short question and try again.' },
  'chat.invalidSession': { es: 'La sesión del chat ya no es válida. Vuelve a enviar tu mensaje para iniciar una sesión nueva. Si vuelve a ocurrir, comprueba que el navegador permite las cookies de este sitio.', en: 'The chat session is no longer valid. Send your message again to start a new session. If this happens again, check that your browser allows cookies for this site.' },
  'chat.waitSeconds': { es: 'Espera al menos {count} segundos.', en: 'Wait at least {count} seconds.' },
  'chat.waitMinutes': { es: 'Espera al menos {count} minutos.', en: 'Wait at least {count} minutes.' },
  'chat.waitHours': { es: 'Espera al menos {count} horas.', en: 'Wait at least {count} hours.' },
  'chat.welcomeBack': { es: 'Hola de nuevo', en: 'Welcome back' },
  'chat.lastTime': { es: 'La última vez hablábamos sobre', en: 'Last time we were talking about' },
  'chat.helpToday': { es: '¿En qué te puedo ayudar hoy?', en: 'How can I help you today?' },
  'chat.helpThisTime': { es: '¿En qué te puedo ayudar esta vez?', en: 'How can I help you this time?' },

  'cta.startProject': { es: 'Quiero iniciar un proyecto con vosotros', en: 'I want to start a project with you' },
};

function detectLang(): Lang {
  if (typeof document === 'undefined') return 'es';
  return document.documentElement.lang === 'en' ? 'en' : 'es';
}

export function getLang(): Lang {
  return detectLang();
}

export function setLang(lang: Lang): void {
  const url = new URL(window.location.href);
  url.search = '';
  if (lang === 'en') url.searchParams.set('lang', 'en');
  window.location.assign(`${url.pathname}${url.search}${url.hash}`);
}

export function textFor(key: string, lang: Lang): string {
  return translations[key]?.[lang] || translations[key]?.es || key;
}

export function t(key: string): string {
  return textFor(key, getLang());
}

export function toggleLang(): Lang {
  const next = getLang() === 'es' ? 'en' : 'es';
  setLang(next);
  return next;
}
