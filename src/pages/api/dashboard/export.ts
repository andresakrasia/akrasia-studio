import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashError, sbQuery } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const leads = await sbQuery('leads', 'order=created_at.desc&limit=1000');
  if (!leads || !Array.isArray(leads)) return dashError('Failed to fetch leads', 500);

  const headers = ['ID', 'Email', 'Phone', 'Name', 'Company', 'Project Type', 'Status', 'Tags', 'Created At'];
  const rows = leads.map((l: Record<string, unknown>) => [
    l.id,
    l.email || '',
    l.phone || '',
    l.name || '',
    l.company || '',
    l.project_type || '',
    l.status || '',
    Array.isArray(l.tags) ? (l.tags as string[]).join('; ') : '',
    l.created_at || '',
  ]);

  const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=akrasia-leads.csv',
    },
  });
};
