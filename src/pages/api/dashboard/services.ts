import { dashboardCrud } from '../../../lib/dashboard-crud';
export const { GET, POST, PATCH, DELETE } = dashboardCrud('services', 'sort_order.asc,id.asc');
