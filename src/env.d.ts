/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly OPENROUTER_API_KEY: string;
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
  readonly EMAIL_REPLY_TO?: string;
  readonly BOOKING_ADMIN_EMAIL?: string;
  readonly BOOKING_MEETING_URL?: string;
  readonly JITSI_MEET_BASE_URL?: string;
  readonly INTEGRATION_WORKER_SECRET?: string;
  readonly INTEGRATION_WORKER_BATCH?: string;
  readonly SUPABASE_URL: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly TELEGRAM_BOT_TOKEN: string;
  readonly TELEGRAM_CHAT_ID: string;
  readonly DASHBOARD_PASSWORD_HASH: string;
  readonly DASHBOARD_ORIGIN: string;
  readonly SITE_URL: string;
  readonly CHAT_SESSION_SECRET?: string;
  readonly CHAT_ORIGIN?: string;
  readonly CHAT_SESSION_SECONDS?: string;
  readonly CHAT_SESSION_REQUESTS?: string;
  readonly CHAT_IP_REQUESTS?: string;
  readonly CHAT_WINDOW_SECONDS?: string;
  readonly CHAT_GLOBAL_REQUESTS?: string;
  readonly CHAT_GLOBAL_UNITS?: string;
  readonly CHAT_GLOBAL_WINDOW_SECONDS?: string;
  readonly CHAT_SESSION_CONCURRENCY?: string;
  readonly CHAT_IP_CONCURRENCY?: string;
  readonly CHAT_GLOBAL_CONCURRENCY?: string;
  readonly CHAT_PROVIDER_TIMEOUT_MS?: string;
  readonly CHAT_STORE_TIMEOUT_MS?: string;
  readonly CHAT_LEASE_SECONDS?: string;
  readonly CHAT_MAX_BODY_BYTES?: string;
  readonly CHAT_MAX_MESSAGES?: string;
  readonly CHAT_MAX_MESSAGE_CHARS?: string;
  readonly CHAT_MAX_HISTORY_BYTES?: string;
  readonly CHAT_MAX_INPUT_UNITS?: string;
  readonly CHAT_MAX_OUTPUT_TOKENS?: string;
  readonly PUBLIC_GTM_CONTAINER_ID?: string;
  readonly PUBLIC_GTM_CONTAINER_REVIEWED?: string;
  readonly PUBLIC_GA4_MEASUREMENT_ID?: string;
  readonly PUBLIC_GA4_REVIEWED?: string;
  readonly PUBLIC_GOOGLE_SITE_VERIFICATION?: string;
  readonly RETENTION_CRON_SECRET?: string;
  readonly CHAT_RETENTION_DAYS?: string;
  readonly CHAT_PROFILE_RETENTION_DAYS?: string;
  readonly NOTIFICATION_RETENTION_DAYS?: string;
  readonly RETENTION_BATCH_SIZE?: string;
}

declare namespace App {
  interface Locals {
    dashboardSession?: import('./lib/dashboard-auth').DashboardSession;
  }
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
