import { readChatConfig, readChatStorageConfig } from './chat-security';
import { readRetentionConfig } from './privacy-retention';

export type ProductionComponent = 'runtime' | 'database' | 'admin' | 'chatSession' | 'ai' | 'bookings' | 'email' | 'telegram' | 'integrationWorker' | 'retention' | 'mediaConsent';
export type ConfigurationState = 'configured' | 'disabled' | 'invalid';
export interface ComponentConfiguration { state: ConfigurationState; codes: string[]; }
export interface ProductionConfigurationReport {
  scope: 'configuration_only';
  status: 'configuration_valid' | 'configuration_invalid';
  nodeMajor: number;
  components: Record<ProductionComponent, ComponentConfiguration>;
  externalChecks: 'not_run';
}
export class ProductionConfigurationError extends Error {
  constructor(public readonly component: ProductionComponent, public readonly codes: readonly string[]) {
    super('production_configuration_invalid');
  }
}
type Environment = Record<string, unknown>;
const PASSWORD_HASH = /^scrypt:131072:8:1:[a-f0-9]{32}:[a-f0-9]{128}$/;
const HEX_SECRET = /^[a-f0-9]{64,128}$/i;
const WORKER_SECRET = /^[a-f0-9]{64}$/i;
const present = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function value(env: Environment, key: string): string { return typeof env[key] === 'string' ? env[key] as string : ''; }
function credential(text: string): boolean {
  return text.length >= 8 && text.length <= 8192 && !/[\s\u0000-\u001f\u007f]/.test(text) &&
    !/your[-_ ]|replace[-_ ]|xxxxx|example\.invalid|placeholder/i.test(text);
}
function origin(text: string, production: boolean): string | null {
  try {
    const url = new URL(text);
    const local = !production && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
function state(codes: string[], disabled = false): ComponentConfiguration {
  return { state: codes.length ? 'invalid' : disabled ? 'disabled' : 'configured', codes };
}
function integer(text: string, min: number, max: number): boolean {
  if (!text) return true;
  if (!/^\d+$/.test(text)) return false;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= min && number <= max;
}
function sender(value: string): boolean {
  if (!value || /[\r\n\u0000]/.test(value)) return false;
  const input = value.trim();
  const address = /[<>]/.test(input) ? /^([^<>\r\n]{1,150}) <([^<>\s]+)>$/.exec(input)?.[2] : input;
  return !!address && address.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(address);
}
const duplicate = (secret: string, env: Environment, keys: string[]) => !!secret && keys.some(key => value(env,key) === secret);
/** Pure validation: never sends requests and never returns configuration values or identities. */
export function inspectProductionConfiguration(env: Environment, options: { production?: boolean; nodeVersion?: string } = {}): ProductionConfigurationReport {
  const production = options.production ?? true;
  const nodeMajor = Number((options.nodeVersion ?? process.versions.node).split('.')[0]);
  const databaseURL = origin(value(env,'SUPABASE_URL'),production);
  const siteURL = origin(value(env,'SITE_URL') || 'https://akrasia.studio',production);
  const dashboardURL = origin(value(env,'DASHBOARD_ORIGIN'),production);
  const chatURL = origin(value(env,'CHAT_ORIGIN'),production);
  const databaseCodes: string[] = [];
  if (!databaseURL) databaseCodes.push('invalid_database_origin');
  if (!credential(value(env,'SUPABASE_SERVICE_ROLE_KEY'))) databaseCodes.push('missing_or_placeholder_database_credential');
  const adminCodes = [...databaseCodes];
  if (!dashboardURL) adminCodes.push('invalid_admin_origin');
  if (!PASSWORD_HASH.test(value(env,'DASHBOARD_PASSWORD_HASH'))) adminCodes.push('invalid_admin_password_hash');
  if (!siteURL) adminCodes.push('invalid_site_origin');
  if (siteURL && dashboardURL && siteURL !== dashboardURL) adminCodes.push('admin_origin_mismatch');

  const sessionEnabled = present(env.CHAT_SESSION_SECRET) || present(env.OPENROUTER_API_KEY);
  const sessionCodes = sessionEnabled ? [...databaseCodes] : [];
  if (sessionEnabled) {
    try { readChatStorageConfig(env,production); } catch { sessionCodes.push('invalid_chat_session_configuration'); }
    if (siteURL && chatURL && siteURL !== chatURL) sessionCodes.push('chat_origin_mismatch');
    if (duplicate(value(env,'CHAT_SESSION_SECRET'), env, ['SUPABASE_SERVICE_ROLE_KEY','OPENROUTER_API_KEY','RETENTION_CRON_SECRET','INTEGRATION_WORKER_SECRET'])) sessionCodes.push('reused_chat_secret');
  }
  const aiEnabled = present(env.OPENROUTER_API_KEY);
  const aiCodes = aiEnabled ? [...sessionCodes] : [];
  if (aiEnabled) {
    if (!credential(value(env,'OPENROUTER_API_KEY'))) aiCodes.push('missing_or_placeholder_ai_credential');
    try { readChatConfig(env,production); } catch { aiCodes.push('invalid_ai_limits_or_configuration'); }
  }

  const bookingCodes = [...sessionCodes];
  const meeting = value(env,'BOOKING_MEETING_URL');
  if (meeting) {
    try { const url = new URL(meeting); if (meeting.length>1024 || url.protocol !== 'https:' || url.username || url.password || url.hash || /[\s\u0000-\u001f\u007f]/.test(meeting)) bookingCodes.push('invalid_meeting_link'); }
    catch { bookingCodes.push('invalid_meeting_link'); }
  } else {
    const jitsi = value(env,'JITSI_MEET_BASE_URL') || 'https://meet.jit.si/';
    try { const url = new URL(jitsi); if (jitsi.length>800 || url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash || /[\s\u0000-\u001f\u007f]/.test(jitsi)) bookingCodes.push('invalid_jitsi_origin'); }
    catch { bookingCodes.push('invalid_jitsi_origin'); }
  }

  const emailEnabled = present(env.RESEND_API_KEY);
  const emailCodes: string[] = [];
  if (emailEnabled) {
    if (!credential(value(env,'RESEND_API_KEY'))) emailCodes.push('missing_or_placeholder_email_credential');
    const from = value(env,'EMAIL_FROM');
    if (!sender(from)) emailCodes.push('invalid_or_missing_email_sender');
    const replyTo = value(env,'EMAIL_REPLY_TO');
    if (replyTo && (!sender(replyTo) || /[<>]/.test(replyTo))) emailCodes.push('invalid_email_reply_to');
    const bookingAdmin = value(env,'BOOKING_ADMIN_EMAIL') || 'info@akrasia.studio';
    if (!sender(bookingAdmin) || /[<>]/.test(bookingAdmin)) emailCodes.push('invalid_booking_admin_email');
    if (!origin(value(env,'SITE_URL') || 'https://akrasia.studio',true)) emailCodes.push('invalid_booking_admin_site_origin');
  }

  const telegramEnabled = present(env.TELEGRAM_BOT_TOKEN) || present(env.TELEGRAM_CHAT_ID);
  const telegramCodes: string[] = [];
  if (telegramEnabled) {
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,128}$/.test(value(env,'TELEGRAM_BOT_TOKEN'))) telegramCodes.push('invalid_or_missing_telegram_token');
    if (!/^-?\d{1,20}$/.test(value(env,'TELEGRAM_CHAT_ID'))) telegramCodes.push('invalid_or_missing_telegram_destination');
  }

  const workerEnabled = present(env.INTEGRATION_WORKER_SECRET);
  const workerCodes = workerEnabled ? [...databaseCodes] : [];
  if (workerEnabled) {
    if (!WORKER_SECRET.test(value(env,'INTEGRATION_WORKER_SECRET'))) workerCodes.push('invalid_worker_secret');
    if (!integer(value(env,'INTEGRATION_WORKER_BATCH'),1,10)) workerCodes.push('invalid_worker_batch');
    if (duplicate(value(env,'INTEGRATION_WORKER_SECRET'),env,['SUPABASE_SERVICE_ROLE_KEY','OPENROUTER_API_KEY','RESEND_API_KEY','TELEGRAM_BOT_TOKEN','CHAT_SESSION_SECRET','DASHBOARD_SESSION_SECRET','RETENTION_CRON_SECRET'])) workerCodes.push('reused_worker_secret');
  }
  if ((emailEnabled || telegramEnabled) && !workerEnabled) workerCodes.push('integration_worker_required');
  const retentionEnabled = sessionEnabled || present(env.RETENTION_CRON_SECRET);
  const retentionCodes = retentionEnabled ? [...databaseCodes] : [];
  if (retentionEnabled) {
    if (!HEX_SECRET.test(value(env,'RETENTION_CRON_SECRET'))) retentionCodes.push('invalid_or_missing_retention_secret');
    if (duplicate(value(env,'RETENTION_CRON_SECRET'),env,['SUPABASE_SERVICE_ROLE_KEY','OPENROUTER_API_KEY','RESEND_API_KEY','TELEGRAM_BOT_TOKEN','CHAT_SESSION_SECRET','INTEGRATION_WORKER_SECRET'])) retentionCodes.push('reused_retention_secret');
    try { readRetentionConfig(env); } catch { retentionCodes.push('invalid_retention_limits'); }
  }
  const mediaCodes: string[] = [];
  const analytics = value(env,'PUBLIC_GTM_CONTAINER_REVIEWED');
  const ga4 = value(env,'PUBLIC_GA4_REVIEWED');
  if (analytics && !['true','false'].includes(analytics)) mediaCodes.push('invalid_analytics_review_flag');
  if (ga4 && !['true','false'].includes(ga4)) mediaCodes.push('invalid_ga4_review_flag');
  if (ga4 === 'true' && !/^G-[A-Z0-9]{4,20}$/.test(value(env,'PUBLIC_GA4_MEASUREMENT_ID'))) mediaCodes.push('invalid_or_missing_ga4_measurement_id');
  if (ga4 !== 'true' && analytics === 'true' && !/^GTM-[A-Z0-9]{4,20}$/.test(value(env,'PUBLIC_GTM_CONTAINER_ID'))) mediaCodes.push('invalid_or_missing_analytics_container');
  const components: Record<ProductionComponent,ComponentConfiguration> = {
    runtime: state(nodeMajor === 24 ? [] : ['unsupported_node_runtime']),
    database: state(databaseCodes), admin: state(adminCodes),
    chatSession: state(sessionCodes,!sessionEnabled), ai: state(aiCodes,!aiEnabled),
    bookings: state(bookingCodes,!sessionEnabled),
    email: state(emailCodes,!emailEnabled), telegram: state(telegramCodes,!telegramEnabled),
    integrationWorker: state(workerCodes,!workerEnabled), retention: state(retentionCodes,!retentionEnabled),
    mediaConsent: state(mediaCodes,analytics !== 'true' && ga4 !== 'true'),
  };
  return { scope:'configuration_only',status:Object.values(components).some(component=>component.state==='invalid') ? 'configuration_invalid' : 'configuration_valid',
    nodeMajor,components,externalChecks:'not_run' };
}

/** Called at a feature boundary. It deliberately does not block unrelated public pages. */
export function requireProductionComponent(component: ProductionComponent, env: Environment, production = true): void {
  const result = inspectProductionConfiguration(env,{production}).components[component];
  if (result.state !== 'configured') throw new ProductionConfigurationError(component,result.codes.length ? result.codes : ['component_disabled']);
}

export type OperationalEventCode = 'configuration_invalid' | 'authenticated_health_check' | 'health_auth_unavailable';
export interface OperationalEvent { event: OperationalEventCode; status: number; durationMs: number; }
/** Only controlled codes/numbers enter logs; no request, URL, headers, payload or errors. */
export function operationalEvent(event: OperationalEvent, sink: (line: string) => void = line => console.info(line)): void {
  if (!['configuration_invalid','authenticated_health_check','health_auth_unavailable'].includes(event.event) ||
    !Number.isInteger(event.status) || event.status < 100 || event.status > 599 || !Number.isFinite(event.durationMs)) return;
  sink(JSON.stringify({ event:event.event,status:event.status,durationMs:Math.max(0,Math.min(60000,Math.round(event.durationMs))) }));
}

