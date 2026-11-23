import { inspectProductionConfiguration, type ConfigurationState } from './production-config';

export interface BookingNotificationStatus {
  recipient: string | null;
  state: ConfigurationState;
  scope: 'configuration_only';
  externalChecks: 'not_run';
}

/** Private admin status: configuration never proves that a message was sent. */
export function bookingNotificationStatus(env: Record<string, unknown>, production = true): BookingNotificationStatus {
  const address = typeof env.BOOKING_ADMIN_EMAIL === 'string' && env.BOOKING_ADMIN_EMAIL ? env.BOOKING_ADMIN_EMAIL : 'info@akrasia.studio';
  const valid = address.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(address);
  const { email, integrationWorker } = inspectProductionConfiguration(env, { production }).components;
  const state: ConfigurationState = !valid || email.state === 'invalid' || integrationWorker.state === 'invalid'
    ? 'invalid' : email.state === 'configured' && integrationWorker.state === 'configured' ? 'configured' : 'disabled';
  return { recipient: valid ? address : null, state, scope: 'configuration_only', externalChecks: 'not_run' };
}
