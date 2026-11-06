import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { attachPreviewProductionAiFixture } from './preview-production-ai-fixture.mjs';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Local memory and gateway requests only. Never loads .env or invokes AI/email.
const project = randomUUID(), other = randomUUID();
const tables = { projects: [{ id: project }, { id: other }], client_journeys: [{ project_id: project, stage: 'accepted' }] };
const state = {};
const clock = () => Date.UTC(2026, 9, 4, 8);
const handler = attachPreviewProductionAiFixture(tables, state, { clock });
const fingerprint = value => createHash('sha256').update(value).digest('hex');
let checks = 0, groups = 0;
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const ok = (actual, message) => { checks++; assert.ok(actual, message); };
const group = async (name, run) => { await run(); console.log(`ok ${++groups} - ${name}`); };
const invoke = (name, body, target = handler) => {
  let response;
  const handled = target({ url: new URL(`http://127.0.0.1/rest/v1/rpc/${name}`), body,
    json: (data, status = 200) => { if (response) throw new Error('Fixture emitted two responses'); response = { status, data: structuredClone(data) }; } });
  return { handled, ...response };
};
const claim = (operation, token) => invoke('dashboard_claim_ai', { p_operation: operation, p_fingerprint: token });
const commit = (operation, token, payload, target = project) => invoke('dashboard_commit_ai', { p_operation: operation, p_fingerprint: token, p_project: target, p_payload: payload });
const oneTask = () => ({ tasks: [{ title: 'Animar producto', description: 'Crear la animación acordada.' }] });
let operation, token, generated;

await group('Only known RPCs and strict operation inputs create one persistent running claim', () => {
  equal(invoke('unknown_rpc', {}).handled, false); equal(tables.dashboard_ai_operations, []);
  for (const body of [null, {}, { p_operation: 'bad', p_fingerprint: 'a'.repeat(64) },
    { p_operation: randomUUID(), p_fingerprint: 'A'.repeat(64) }, { p_operation: randomUUID(), p_fingerprint: 'a'.repeat(63) },
    { p_operation: randomUUID(), p_fingerprint: 'a'.repeat(64), extra: true }]) equal(invoke('dashboard_claim_ai', body).status, 400);
  equal(tables.dashboard_ai_operations.length, 0);
  operation = randomUUID(); token = fingerprint('first generation');
  equal(claim(operation, token), { handled: true, status: 200, data: { state: 'claimed' } });
  equal(claim(operation, token).data, { state: 'running', result: null });
  equal(claim(operation, fingerprint('different generation')).status, 409);
  equal(tables.dashboard_ai_operations.length, 1); equal(tables.dashboard_ai_operations[0].created_at, '2026-10-04T08:00:00.000Z');
});
await group('Missing claims, foreign projects, malformed lists and invalid fields write nothing', () => {
  equal(commit(randomUUID(), token, oneTask()).status, 404);
  equal(commit(operation, fingerprint('conflict'), oneTask()).status, 409);
  equal(commit(operation, token, oneTask(), randomUUID()).status, 409);
  const bad = [null, {}, [], { tasks: [] }, { tasks: Array.from({ length: 13 }, () => oneTask().tasks[0]) },
    { tasks: oneTask().tasks, feed: [{ text: 'Mixed contract', level: 'mid' }] }, { tasks: [{ title: '', description: '' }] },
    { tasks: [{ title: 'x'.repeat(301), description: '' }] }, { tasks: [{ title: 'Valid title', description: 'x'.repeat(5001) }] },
    { tasks: [{ title: 'Valid title', description: '', status: 'completed' }] }, { tasks: [{ title: 'Valid title', description: 1 }] },
    { tasks: [{ title: 'Valid title' }] }, { tasks: [{ title: 'NUL\u0000', description: '' }] }, { unknown: [] }];
  for (const payload of bad) equal(commit(operation, token, payload).status, 400);
  equal(commit(operation, token, oneTask(), null).status, 400);
  equal(tables.project_tasks.length, 0); equal(tables.feed_entries.length, 0); equal(tables.studio_logs.length, 0);
  equal(tables.dashboard_ai_operations[0].state, 'running'); equal(tables.dashboard_ai_operations[0].result, null);
});
await group('Maximum-size task commits bind all rows to one project with private pending defaults', () => {
  tables.project_tasks.push({ id: randomUUID(), project_id: other, title: 'Other project canary', status: 'completed' });
  const payload = { tasks: Array.from({ length: 12 }, (_, index) => ({ title: index === 0 ? 'x'.repeat(300) : `Production ${index}`, description: index === 0 ? 'x'.repeat(5000) : '' })) };
  generated = commit(operation, token, payload); equal(generated.status, 200); equal(generated.data.tasks.length, 12);
  for (const task of generated.data.tasks) {
    equal(task.project_id, project); equal(task.status, 'pending'); equal(task.priority, 'medium'); equal(task.created_by, 'ai');
    equal(task.created_at, '2026-10-04T08:00:00.000Z');
  }
  equal(tables.project_tasks.filter(task => task.project_id === other).length, 1);
  equal(tables.dashboard_ai_operations[0].state, 'complete');
  equal(tables.dashboard_ai_operations[0].result.tasks, generated.data.tasks.map(task => task.id));
  ok(!JSON.stringify(tables.dashboard_ai_operations[0].result).includes('Production'));
  equal(claim(operation, token).data, { state: 'complete', result: generated.data });
});
await group('Replay resolves current rows and deleted tasks stay deleted rather than resurrecting text', () => {
  const changed = generated.data.tasks[1]; const deleted = generated.data.tasks[0];
  tables.project_tasks.find(row => row.id === changed.id).title = 'Manual correction after generation';
  tables.project_tasks = tables.project_tasks.filter(row => row.id !== deleted.id);
  const before = tables.project_tasks.length;
  const replay = commit(operation, token, null); equal(replay.status, 200); equal(replay.data.tasks.length, 11);
  equal(replay.data.tasks[0].id, changed.id); equal(replay.data.tasks[0].title, 'Manual correction after generation');
  ok(!replay.data.tasks.some(row => row.id === deleted.id)); equal(tables.project_tasks.length, before);
  equal(invoke('dashboard_ai_result', { p_operation: operation }).data, replay.data);
  equal(invoke('dashboard_ai_result', { p_operation: randomUUID() }).data, null);
});
await group('Activity generation is atomic across both lists and remains an unpublished internal proposal', () => {
  const activity = randomUUID(), activityToken = fingerprint('internal activity'); equal(claim(activity, activityToken).status, 200);
  const payload = { feed: [{ text: 'Propuesta interna de revisión', level: 'mid' }], logs: [{ text: 'Propuesta de proceso', log_type: 'info' }] };
  for (const bad of [{ feed: payload.feed }, { feed: [], logs: payload.logs }, { feed: payload.feed, logs: [{ text: '', log_type: 'info' }] },
    { feed: payload.feed, logs: [{ text: 'Log invalid type', log_type: 'fatal' }] }, { feed: [{ text: 'Feed invalid level', level: 'fatal' }], logs: payload.logs },
    { feed: payload.feed, logs: [...payload.logs, ...payload.logs, ...payload.logs, ...payload.logs] }]) equal(commit(activity, activityToken, bad).status, 400);
  equal(tables.feed_entries.length, 0); equal(tables.studio_logs.length, 0); equal(tables.dashboard_ai_operations.at(-1).state, 'running');
  const saved = commit(activity, activityToken, payload); equal(saved.status, 200);
  for (const row of [...saved.data.feed, ...saved.data.logs]) {
    equal(row.project_id, project); equal(row.source, 'ai'); equal(row.is_active, false); equal(row.is_published, false);
    equal(row.public_revision, 0); equal(row.public_title, ''); equal(row.public_title_en, ''); equal(row.public_text, ''); equal(row.public_text_en, ''); equal(row.public_occurred_at, null);
  }
  equal(commit(activity, activityToken, payload).data, saved.data); equal(tables.feed_entries.length, 1); equal(tables.studio_logs.length, 1);
  const global = randomUUID(), globalToken = fingerprint('studio activity'); claim(global, globalToken);
  equal(commit(global, globalToken, payload, null).status, 200); equal(tables.feed_entries.at(-1).project_id, null);
});
await group('Snapshot restoration preserves receipts and closed-project gates reject new pending work', () => {
  const restored = structuredClone(tables); const restoredHandler = attachPreviewProductionAiFixture(restored, {}, { clock });
  equal(invoke('dashboard_claim_ai', { p_operation: operation, p_fingerprint: token }, restoredHandler).data.result.tasks.length, 11);
  for (const stage of ['delivered', 'closed']) {
    tables.client_journeys[0].stage = stage; const id = randomUUID(), hash = fingerprint(stage); claim(id, hash);
    const before = tables.project_tasks.length; equal(commit(id, hash, oneTask()).status, 409); equal(tables.project_tasks.length, before); equal(tables.dashboard_ai_operations.at(-1).state, 'running');
  }
  tables.client_journeys[0].stage = 'review';
  const id = randomUUID(), hash = fingerprint('storage failure'); state.productionAiUnavailable = true;
  equal(claim(id, hash).status, 503); ok(!tables.dashboard_ai_operations.some(row => row.id === id));
  state.productionAiUnavailable = false; equal(claim(id, hash).status, 200); equal(commit(id, hash, oneTask()).status, 200);
});
await group('The interactive gateway authorizes and dispatches the exact preview RPCs without providers', async () => {
  const fixture = await createChatFirstPreviewFixture({ clock }); const network = installFetchGuard(fixture.allowedOrigins);
  try {
    const id = randomUUID(), hash = fingerprint('gateway generation'), projectId = randomUUID();
    fixture.tables.projects.push({ id: projectId, title: 'Private gateway project', is_published: false });
    const rpc = async (name, body, { method = 'POST', suffix = '', key = TEST_SERVICE_KEY } = {}) => {
      const response = await fetch(`${fixture.origin}/rest/v1/rpc/${name}${suffix}`, { method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    };
    equal((await rpc('dashboard_claim_ai', { p_operation: id, p_fingerprint: hash }, { key: 'bad-key' })).status, 403);
    equal((await rpc('dashboard_claim_ai', { p_operation: id, p_fingerprint: hash }, { method: 'GET' })).status, 400);
    equal((await rpc('dashboard_claim_ai', { p_operation: id, p_fingerprint: hash }, { suffix: '?extra=1' })).status, 400);
    equal(await rpc('dashboard_claim_ai', { p_operation: id, p_fingerprint: hash }), { status: 200, data: { state: 'claimed' } });
    equal((await rpc('dashboard_claim_ai', { p_operation: id, p_fingerprint: hash })).data.state, 'running');
    const body = { p_operation: id, p_fingerprint: hash, p_project: projectId, p_payload: oneTask() };
    const saved = await rpc('dashboard_commit_ai', body); equal(saved.status, 200); equal(saved.data.tasks.length, 1);
    equal(saved.data.tasks[0].project_id, projectId); equal(saved.data.tasks[0].status, 'pending');
    equal((await rpc('dashboard_commit_ai', body)).data, saved.data); equal(fixture.tables.project_tasks.filter(row => row.project_id === projectId).length, 1);
    equal((await rpc('dashboard_ai_result', { p_operation: id })).data, saved.data);
    equal(fixture.tables.dashboard_ai_operations.length, 1); equal(fixture.tables.dashboard_ai_operations[0].result.tasks, saved.data.tasks.map(row => row.id));
    ok(fixture.requests.some(request => request.target === 'synthetic-production')); equal(network.blocked, []);
  } finally { network.restore(); await fixture.close(); }
});
console.log(`PASS preview production AI fixture: ${groups} groups, ${checks} checks; local memory/gateway only, no providers.`);
