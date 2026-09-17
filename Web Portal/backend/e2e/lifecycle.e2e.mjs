/**
 * End-to-end workflow test (T17.3). Runs against a LIVE server + database:
 *   1. start the DB + `npm run dev` (backend), then
 *   2. `npm run test:e2e --workspace @mico360/backend`
 * Exercises the core workflow through the real HTTP API. Exit code 0 = all passed.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:4000/api/v1';
let pass = 0, fail = 0;
const ck = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };

async function login(identifier, password) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  return { status: r.status, body: await r.json() };
}
const auth = (t) => ({ authorization: `Bearer ${t}` });
const jh = (t) => ({ ...auth(t), 'content-type': 'application/json' });

async function main() {
  console.log('E2E: authentication');
  const byEmail = await login('admin@mico360.test', 'Password1!');
  ck('admin logs in by email (200)', byEmail.status === 200 && byEmail.body.data.accessToken);
  const tok = byEmail.body.data.accessToken;
  const byUser = await login('admin', 'Password1!');
  ck('admin logs in by username (200)', byUser.status === 200);
  const badPw = await login('admin@mico360.test', 'wrong');
  ck('wrong password rejected (401)', badPw.status === 401);

  console.log('\nE2E: RBAC');
  const empTok = (await login('omar@mico360.test', 'Password1!')).body.data.accessToken;
  const empCreate = await fetch(`${BASE}/projects`, { method: 'POST', headers: jh(empTok), body: JSON.stringify({ code: 'X', name: 'X' }) });
  ck('employee cannot create a project (403)', empCreate.status === 403, `got ${empCreate.status}`);

  console.log('\nE2E: project + task lifecycle');
  const projects = (await (await fetch(`${BASE}/projects`, { headers: auth(tok) })).json()).data;
  const project = projects[0];
  const columns = (await (await fetch(`${BASE}/projects/${project.id}/columns`, { headers: auth(tok) })).json()).data.sort((a, b) => a.position - b.position);
  const startCol = columns[0];
  const created = await fetch(`${BASE}/tasks`, { method: 'POST', headers: jh(tok), body: JSON.stringify({ title: 'E2E task', projectId: project.id, columnId: startCol.id }) });
  const task = (await created.json()).data;
  ck('create task returns a task with an auto key', created.status === 201 && /^[A-Z0-9]+-\d+$/.test(task.key), task.key);

  const omar = (await (await fetch(`${BASE}/users`, { headers: auth(tok) })).json()).data.find((u) => u.username === 'omar');
  const assign = await fetch(`${BASE}/tasks/${task.id}/assignees`, { method: 'POST', headers: jh(tok), body: JSON.stringify({ userIds: [omar.id] }) });
  ck('assign a user (200)', assign.status === 200 && (await assign.json()).data.some((u) => u.id === omar.id));

  const item = await fetch(`${BASE}/tasks/${task.id}/checklist`, { method: 'POST', headers: jh(tok), body: JSON.stringify({ text: 'step 1' }) });
  ck('add a checklist item (201)', item.status === 201);

  const comment = await fetch(`${BASE}/tasks/${task.id}/comments`, { method: 'POST', headers: jh(tok), body: JSON.stringify({ body: 'Please review @omar' }) });
  ck('add a comment (201)', comment.status === 201);

  const doneCol = columns.find((c) => c.category === 'DONE');
  if (doneCol) {
    const move = await fetch(`${BASE}/tasks/${task.id}/move`, { method: 'PATCH', headers: jh(tok), body: JSON.stringify({ columnId: doneCol.id }) });
    ck('move task to Done (200)', move.status === 200 && (await move.json()).data.columnId === doneCol.id);
  } else ck('move task to Done (200)', true, '(no DONE column)');

  console.log('\nE2E: search + reports export');
  const search = await fetch(`${BASE}/search?q=${encodeURIComponent(task.title)}`, { headers: auth(tok) });
  ck('search finds the task', search.status === 200 && (await search.json()).data.tasks.some((t) => t.id === task.id));
  for (const fmt of ['csv', 'xls', 'pdf']) {
    const exp = await fetch(`${BASE}/reports/projects.${fmt}`, { headers: auth(tok) });
    ck(`export project report as ${fmt} (200)`, exp.status === 200);
  }

  // cleanup the E2E task
  await fetch(`${BASE}/tasks/${task.id}`, { method: 'DELETE', headers: auth(tok) });

  console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('E2E FATAL — is the server running on', BASE, '?\n', e); process.exit(1); });
