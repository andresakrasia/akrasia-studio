import { requestsMeetingGuide } from './booking-guide';

interface MeetingMessage { role: string; content: string }
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’]/g, "'").trim();
const preference = /\b(?:prefiero (?:hablar |seguir |contactar )?(?:por )?(?:email|correo|chat|el chat|aqui)|seguir por aqui|solo (?:por )?chat|prefer (?:chat|email)|keep chatting)\b/;
const refusal = /\b(?:no quiero|no necesito|no me interesa|no gracias|no puedo (?:hacer )?(?:una? )?(?:videollamada|llamada|reunion)|no me gustaria|sin (?:una? )?(?:llamada|videollamada|reunion)|cancelar|cancel|don't want|do not want|no longer want|no thanks)\b/;
const acceptance = /^(?:si\b|claro\b|vale\b|de acuerdo\b|perfecto\b|adelante\b|acepto\b|me interesa\b|me gustaria\b|yes\b|sure\b|okay\b|ok\b|sounds good\b|let's do it\b|i'd (?:like that|love to)\b)/;
const dateReply = /^(?:manana\b|pasado manana\b|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2})\b|\d{4}-\d{2}-\d{2}\b|tomorrow\b|on \b|at \d)/;

/** Close an existing picker only for a call refusal or a choice to continue elsewhere. */
export function declinesMeetingGuide(message: string): boolean {
  const text = normalize(message);
  return preference.test(text) || /^(?:no gracias|no thanks)\b/.test(text) ||
    (refusal.test(text) && /\b(?:videollamada|llamada|reunion|video call|meeting|call)\b/.test(text));
}

/** Only a visitor's request or acceptance of the latest offer opens the guide. */
export function wantsMeetingGuide(message: string, history: MeetingMessage[]): boolean {
  const text = normalize(message);
  if (refusal.test(text) || preference.test(text)) return false;
  if (requestsMeetingGuide(message)) return true;
  const previous = history.at(-1);
  if (previous?.role !== 'assistant') return false;
  const offer = normalize(previous.content);
  if (!/\b(?:videollamada|video call|llamada de 30|meeting)\b/.test(offer) ||
    !/\b(?:interesa|quieres|apetece|muestre|puedo|podemos|reservar|elige|would|can|book|choose|like|interested|shall)\b/.test(offer)) return false;
  return acceptance.test(text) || dateReply.test(text);
}

/** Candidates may need stored context before a decision can be made. */
export function meetingGuideCandidate(message: string): boolean {
  const text = normalize(message);
  return !refusal.test(text) && !preference.test(text) && (requestsMeetingGuide(message) || acceptance.test(text) || dateReply.test(text));
}

export function meetingGuideReply(language: 'es' | 'en'): string {
  return language === 'en'
    ? 'Choose an available day and time in the calendar below for a 30-minute video call with the team. Then leave your email and review the details before confirming. You can also keep developing your idea here.'
    : 'Elige un día y una hora disponibles en el calendario de abajo para una videollamada de 30 minutos con el equipo. Después deja tu email y revisa los datos antes de confirmar. También podemos seguir desarrollando tu idea aquí.';
}

/** Replaying this server-owned reply restores the same non-mutating guide. */
export function isMeetingGuideReply(response: string): boolean {
  return response === meetingGuideReply('es') || response === meetingGuideReply('en');
}
