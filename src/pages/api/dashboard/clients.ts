import { dashboardCrud } from '../../../lib/dashboard-crud';
export const { GET, POST, PATCH, DELETE } = dashboardCrud('clients', 'name.asc,id.asc');
