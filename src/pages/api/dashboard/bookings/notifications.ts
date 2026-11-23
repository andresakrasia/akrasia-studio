import { dashboardRoute, dashResponse } from '../../../../lib/dashboard';
import { bookingNotificationStatus } from '../../../../lib/booking-notification-status';

export const GET = dashboardRoute(async () => dashResponse(bookingNotificationStatus(import.meta.env, import.meta.env.PROD)));
