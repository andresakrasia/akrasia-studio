// Technical defaults for the proposed operational policy. The owner must confirm
// the purposes and periods before production activation; these are not legal limits.
export const RETENTION_DEFAULTS = Object.freeze({ chatDays: 30, profileDays: 90, notificationDays: 90, batchSize: 100 });
export interface RetentionConfig { chatDays: number; profileDays: number; notificationDays: number; batchSize: number }
export function readRetentionConfig(env: Record<string, unknown>): RetentionConfig {
  function integer(key: string, fallback: number, maximum: number) {
    const value = env[key];
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('invalid_retention_config');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error('invalid_retention_config');
    return number;
  }
  return { chatDays: integer('CHAT_RETENTION_DAYS', RETENTION_DEFAULTS.chatDays, 365),
    profileDays: integer('CHAT_PROFILE_RETENTION_DAYS', RETENTION_DEFAULTS.profileDays, 730),
    notificationDays: integer('NOTIFICATION_RETENTION_DAYS', RETENTION_DEFAULTS.notificationDays, 730),
    batchSize: integer('RETENTION_BATCH_SIZE', RETENTION_DEFAULTS.batchSize, 500) };
}
