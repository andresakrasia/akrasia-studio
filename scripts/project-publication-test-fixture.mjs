import { createDashboardTestFixture } from './dashboard-auth-test-fixture.mjs';

export const PRIVATE_MARKER = 'A06_PRIVATE_DO_NOT_PUBLISH';
export async function createProjectPublicationFixture() {
  const fixture = await createDashboardTestFixture();
  const statuses = ['planning', 'in_production', 'post_production', 'completed', 'delivered'];
  fixture.tables.projects = statuses.flatMap((status, i) => [false, true].map((is_published, j) => ({
    id: `00000000-0000-4000-8000-${String(i * 2 + j + 10).padStart(12, '0')}`,
    slug: `a06-${status.replaceAll('_', '-')}-${is_published ? 'public' : 'private'}`,
    title: is_published ? `A06 Público ${status}` : `${PRIVATE_MARKER} ${status}`,
    is_published, status, sort_order: i * 2 + j, type: 'Video ficticio', category: 'test',
    thumbnail: '/favicon.svg', video_url: '', resolution: '1920x1080', aspect: '16:9', duration: '30s',
    public_description: is_published ? 'Texto aprobado para el portfolio de prueba.' : PRIVATE_MARKER,
    client_name: PRIVATE_MARKER, client_id: '00000000-0000-4000-8000-000000000002',
    description: PRIVATE_MARKER, notes: PRIVATE_MARKER, budget: PRIVATE_MARKER,
    client: { email: PRIVATE_MARKER }, tasks: [{ title: PRIVATE_MARKER }], task_progress: { completed: 99 },
    future_sensitive_column: PRIVATE_MARKER, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:00Z',
  })));
  fixture.tables.clients[0].id = '00000000-0000-4000-8000-000000000002';
  fixture.tables.project_tasks = [{ id: '00000000-0000-4000-8000-000000000003', project_id: fixture.tables.projects[0].id,
    title: PRIVATE_MARKER, description: PRIVATE_MARKER, status: 'pending', priority: 'medium' }];
  fixture.tables.feed_entries = [{ id: 'private-feed', project_id: null, text: PRIVATE_MARKER, is_active: true, level: 'high' }];
  fixture.tables.studio_logs = [{ id: 'private-log', project_id: fixture.tables.projects[1].id, text: PRIVATE_MARKER, is_active: true, log_type: 'success' }];
  fixture.tables.studio_stats = [{ key: 'active_clients', value: 42, label: PRIVATE_MARKER }];
  return fixture;
}
