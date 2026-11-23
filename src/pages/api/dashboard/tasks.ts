import { dashboardCrud } from '../../../lib/dashboard-crud';
export const { GET, POST, PATCH, DELETE } = dashboardCrud('tasks', 'created_at.desc,id.desc');
