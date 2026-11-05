import { randomUUID } from 'node:crypto';

// Preview-only mirror of v16 receipts and v21 task gates. This never calls an
// AI/email provider and is not imported by an application or migration route.
export function attachPreviewProductionAiFixture(tables, state, { clock = Date.now } = {}) {
  for (const name of ['dashboard_ai_operations', 'project_tasks', 'feed_entries', 'studio_logs']) tables[name] ??= [];
  const copy = value => structuredClone(value);
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
  const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  const text = (value, min, max) => typeof value === 'string' && !value.includes('\u0000') && [...value].length >= min && [...value].length <= max;
  const stamp = () => new Date(clock()).toISOString();
  const names = { tasks: 'project_tasks', feed: 'feed_entries', logs: 'studio_logs' };
  const result = operation => {
    if (operation.state !== 'complete' || operation.result == null) return null;
    if (!object(operation.result) || Object.keys(operation.result).some(bucket => !Object.hasOwn(names, bucket) || !Array.isArray(operation.result[bucket]))) throw new Error('Invalid synthetic AI receipt');
    return Object.fromEntries(Object.entries(operation.result).map(([bucket, ids]) => [bucket,
      ids.map(id => tables[names[bucket]].find(row => row.id === id)).filter(Boolean).map(copy)]));
  };
  const editorial = () => ({ public_title: '', public_title_en: '', public_text: '', public_text_en: '',
    public_event_type: 'studio', public_occurred_at: null, public_revision: 0, is_published: false });

  return ({ url, body, json }) => {
    const name = url.pathname.replace('/rest/v1/rpc/', '');
    if (!['dashboard_claim_ai', 'dashboard_commit_ai', 'dashboard_ai_result'].includes(name)) return false;
    if (state.productionAiUnavailable) { json({ error: 'Synthetic AI receipt storage unavailable' }, 503); return true; }
    try {
      const keys = name === 'dashboard_claim_ai' ? ['p_operation', 'p_fingerprint']
        : name === 'dashboard_commit_ai' ? ['p_operation', 'p_fingerprint', 'p_project', 'p_payload'] : ['p_operation'];
      if (!exact(body, keys) || !uuid(body.p_operation) || name !== 'dashboard_ai_result' && !fingerprint(body.p_fingerprint)) {
        json({ error: 'Invalid synthetic AI operation' }, 400); return true;
      }
      const previous = tables.dashboard_ai_operations.find(row => row.id === body.p_operation);
      if (name === 'dashboard_ai_result') { json(previous ? result(previous) : null); return true; }
      if (previous && previous.fingerprint !== body.p_fingerprint) { json({ error: 'Synthetic AI operation conflict' }, 409); return true; }
      if (name === 'dashboard_claim_ai') {
        if (previous) json({ state: previous.state, result: previous.state === 'complete' ? result(previous) : null });
        else { tables.dashboard_ai_operations.push({ id: body.p_operation, fingerprint: body.p_fingerprint, state: 'running', result: null, created_at: stamp() }); json({ state: 'claimed' }); }
        return true;
      }
      if (!previous) { json({ error: 'Synthetic AI operation missing' }, 404); return true; }
      if (previous.state === 'complete') { json(result(previous)); return true; }
      const payload = body.p_payload;
      const hasTasks = Object.hasOwn(payload ?? {}, 'tasks');
      if (!object(payload) || Object.keys(payload).some(bucket => !Object.hasOwn(names, bucket)) ||
        (hasTasks ? Object.keys(payload).length !== 1 : !exact(payload, ['feed', 'logs'])) ||
        (body.p_project !== null && !uuid(body.p_project)) || (hasTasks && body.p_project === null)) {
        json({ error: 'Invalid synthetic AI payload' }, 400); return true;
      }
      if (body.p_project !== null && !tables.projects?.some(row => row.id === body.p_project)) { json({ error: 'Synthetic AI project missing' }, 409); return true; }
      if (hasTasks && tables.client_journeys?.some(row => row.project_id === body.p_project && ['delivered', 'closed'].includes(row.stage))) {
        json({ error: 'Synthetic closed project requires reopening before pending work' }, 409); return true;
      }
      // Validate every list/item before staging any rows. Invalid second buckets
      // cannot leave a partial task, feed entry, log or complete receipt.
      for (const [bucket, entries] of Object.entries(payload)) {
        if (!Array.isArray(entries) || entries.length < 1 || entries.length > (bucket === 'tasks' ? 12 : 3)) { json({ error: 'Invalid synthetic AI list' }, 400); return true; }
        for (const item of entries) {
          const valid = bucket === 'tasks' ? exact(item, ['title', 'description']) && text(item.title, 1, 300) && text(item.description, 0, 5000)
            : bucket === 'feed' ? exact(item, ['text', 'level']) && text(item.text, 1, 2000) && ['high', 'mid', 'low'].includes(item.level)
              : exact(item, ['text', 'log_type']) && text(item.text, 1, 2000) && ['success', 'info', 'warning'].includes(item.log_type);
          if (!valid) { json({ error: 'Invalid synthetic AI item' }, 400); return true; }
        }
      }
      const generated = Object.fromEntries(Object.entries(payload).map(([bucket, entries]) => [bucket, entries.map(item => ({
        id: randomUUID(), project_id: body.p_project, ...copy(item), created_at: stamp(),
        ...(bucket === 'tasks' ? { status: 'pending', priority: 'medium', created_by: 'ai' } : { source: 'ai', is_active: false, ...editorial() }),
      }))]));
      for (const [bucket, rows] of Object.entries(generated)) tables[names[bucket]].push(...rows);
      previous.state = 'complete';
      previous.result = Object.fromEntries(Object.entries(generated).map(([bucket, rows]) => [bucket, rows.map(row => row.id)]));
      json(copy(generated)); return true;
    } catch { json({ error: 'Synthetic AI receipt storage failed' }, 503); return true; }
  };
}
