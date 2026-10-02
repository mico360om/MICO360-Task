#!/usr/bin/env node
/**
 * Release acceptance test for a freshly installed MICO360 Tasks server (the Windows installer, or
 * any deployment). Starts from nothing but the administrator account, creates its own data (a
 * user, a project, tasks, files, a chat message, a meeting) and checks every major feature over
 * HTTP, including the web app served from the same address.
 *
 *   VERIFY_URL=http://localhost:4000 VERIFY_ADMIN=admin@mico360.test VERIFY_PASSWORD='…' node tools/release/verify-server.mjs
 *
 * Safe to run more than once (names get a unique suffix). Exit code 0 = everything passed.
 */
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { io } from 'socket.io-client';

const ORIGIN = (process.env.VERIFY_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const B = `${ORIGIN}/api/v1`;
const ADMIN = process.env.VERIFY_ADMIN ?? 'admin@mico360.test';
const PASSWORD = process.env.VERIFY_PASSWORD;
if (!PASSWORD) {
  console.error('Set VERIFY_PASSWORD (and VERIFY_ADMIN) to the administrator account of the server under test.');
  process.exit(2);
}
const run = randomUUID().slice(0, 6);

let pass = 0;
let fail = 0;
const ck = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  → ${extra}`}`);
};
const section = (s) => console.log(`\n${s}`);
/** The text of every part of a zip (an .xlsx), via its central directory. */
function unzipText(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return new Map();
  const files = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + buf.readUInt32LE(p + 20));
    files.set(buf.toString('utf8', p + 46, p + 46 + nameLen), (buf.readUInt16LE(p + 10) === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}
const fileName = (res) => /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? '';
const json = async (r) => ({ s: r.status, h: r.headers, b: await r.json().catch(() => null) });
const login = (identifier, password) =>
  fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) }).then(json);
const client = (token) => {
  const H = { authorization: `Bearer ${token}` };
  return {
    get: (p) => fetch(`${B}${p}`, { headers: H }).then(json),
    post: (p, body, extra = {}) => fetch(`${B}${p}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) }).then(json),
    patch: (p, body) => fetch(`${B}${p}`, { method: 'PATCH', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(json),
    put: (p, body) => fetch(`${B}${p}`, { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(json),
    del: (p) => fetch(`${B}${p}`, { method: 'DELETE', headers: H }),
    raw: (p) => fetch(`${B}${p}`, { headers: H }),
    upload: (p, fd) => fetch(`${B}${p}`, { method: 'POST', headers: H, body: fd }).then(json),
  };
};

// ------------------------------------------------------------------ web app on the same address
section('Web app (served by the server itself)');
const home = await fetch(`${ORIGIN}/`);
const homeHtml = await home.text();
ck('GET / returns the web app', home.status === 200 && homeHtml.includes('<div id="root">'), String(home.status));
ck('page security headers (CSP, frame blocking, nosniff)',
  /frame-ancestors 'none'/.test(home.headers.get('content-security-policy') ?? '') && home.headers.get('x-frame-options') === 'DENY' && home.headers.get('x-content-type-options') === 'nosniff');
ck('index.html is always revalidated', home.headers.get('cache-control') === 'no-cache', home.headers.get('cache-control'));
const deep = await fetch(`${ORIGIN}/projects/some-id/board`);
ck('client-side routes load the app (deep links work)', deep.status === 200 && (await deep.text()).includes('<div id="root">'));
const script = /src="(\/assets\/[^"]+\.js)"/.exec(homeHtml)?.[1];
const asset = script ? await fetch(`${ORIGIN}${script}`) : null;
ck('hashed scripts are served with a one-year cache', !!asset && asset.status === 200 && /immutable/.test(asset.headers.get('cache-control') ?? ''), script ?? 'no script tag');
const links = await fetch(`${ORIGIN}/.well-known/assetlinks.json`);
ck('Android App Links file is published', links.status === 200 && Array.isArray(await links.json().catch(() => null)));
for (const page of ['/privacy', '/terms']) {
  const res = await fetch(`${ORIGIN}${page}`);
  ck(`public ${page} page loads without signing in`, res.status === 200 && (await res.text()).includes('<div id="root">'));
}
if (process.env.VERIFY_EXPECT_APK === '1') {
  const apk = await fetch(`${ORIGIN}/downloads/MICO360-Tasks.apk`, { method: 'HEAD' });
  ck('the Android app can be downloaded from this server', apk.status === 200 && /android\.package-archive|octet-stream/.test(apk.headers.get('content-type') ?? ''), `${apk.status} ${apk.headers.get('content-type')}`);
}
const missing = await fetch(`${B}/no-such-endpoint`);
ck('unknown API paths answer JSON 404 (not the web page)', missing.status === 404 && (await missing.json().catch(() => ({}))).error?.code === 'NOT_FOUND');

section('Server status');
const health = await fetch(`${B}/health`).then(json);
ck('health check is ok', health.s === 200 && health.b?.data?.status === 'ok');
const config = await fetch(`${B}/config`).then(json);
ck('company time zone is Asia/Muscat', config.b?.data?.timeZone === 'Asia/Muscat', JSON.stringify(config.b));
ck('config says where to download the Android app (a link, or null for the releases page)', config.b?.data && 'androidAppUrl' in config.b.data, JSON.stringify(config.b));
if (process.env.VERIFY_EXPECT_APK === '1') {
  ck('the sign-in page offers the Android app this server hosts', config.b?.data?.androidAppUrl === '/downloads/MICO360-Tasks.apk', JSON.stringify(config.b?.data?.androidAppUrl));
}

// ------------------------------------------------------------------ accounts
section('Sign-in and accounts');
const adminLogin = await login(ADMIN, PASSWORD);
ck('administrator signs in', adminLogin.s === 200 && !!adminLogin.b?.data?.accessToken, String(adminLogin.s));
if (adminLogin.s !== 200) {
  console.log(`\nFAILURES: cannot continue without the administrator (${pass} passed, ${fail + 1} failed)`);
  process.exit(1);
}
const adminUser = adminLogin.b.data.user;
const admin = client(adminLogin.b.data.accessToken);
const byUsername = await login(adminUser.username, PASSWORD);
ck('sign-in by username works too', byUsername.s === 200);
ck('a wrong password is refused (401)', (await login(ADMIN, 'not-the-password-1')).s === 401);
const refreshed = await fetch(`${B}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: byUsername.b.data.refreshToken }) }).then(json);
ck('sessions refresh silently', refreshed.s === 200 && !!refreshed.b?.data?.accessToken);

const empPassword = `Emp-${randomUUID().slice(0, 8)}9`;
const emp = await admin.post('/users', {
  email: `sara.${run}@example.com`, username: `sara_${run}`, password: empPassword, firstName: 'سارة', lastName: 'Al Balushi', roleNames: ['EMPLOYEE'],
});
ck('administrator adds an employee (Arabic first name)', emp.s === 201, JSON.stringify(emp.b));
const empLogin = await login(`sara_${run}`, empPassword);
ck('the new employee signs in', empLogin.s === 200, String(empLogin.s));
const employee = client(empLogin.b?.data?.accessToken);

// ------------------------------------------------------------------ projects and tasks
section('Projects and tasks');
const project = await admin.post('/projects', { code: `R${run.slice(0, 4).toUpperCase()}`, name: `مشروع الإطلاق ${run}`, description: 'Release acceptance project' });
ck('create a project with an Arabic name (201)', project.s === 201, JSON.stringify(project.b));
const projectId = project.b?.data?.id;
const columns = ((await admin.get(`/projects/${projectId}/columns`)).b?.data ?? []).sort((a, b) => a.position - b.position);
ck('a new project gets its default board columns', columns.length >= 3, `${columns.length} columns`);
const member = await admin.post(`/projects/${projectId}/members`, { userIds: [emp.b?.data?.id] });
ck('add the employee to the project', member.s >= 200 && member.s < 300, String(member.s));
ck('employees cannot create projects (403)', (await employee.post('/projects', { code: 'NOPE', name: 'Nope' })).s === 403);

const arTitle = `مراجعة تقرير المبيعات الشهري ${run}`;
const task = await admin.post('/tasks', { title: arTitle, description: 'تفاصيل المهمة مع English و 123', projectId, columnId: columns[0]?.id, dueDate: '2026-12-31' });
ck('create a task with an Arabic title and a due date (201)', task.s === 201 && /^[A-Z0-9]+-\d+$/.test(task.b?.data?.key ?? ''), JSON.stringify(task.b));
const taskId = task.b?.data?.id;
const back = await admin.get(`/tasks/${taskId}`);
ck('Arabic text and the due day read back unchanged', back.b?.data?.title === arTitle && String(back.b?.data?.dueDate).startsWith('2026-12-31'), JSON.stringify(back.b?.data?.dueDate));
const assign = await admin.post(`/tasks/${taskId}/assignees`, { userIds: [emp.b?.data?.id] });
ck('assign the task to the employee', assign.s === 200, String(assign.s));
ck('add a checklist item', (await admin.post(`/tasks/${taskId}/checklist`, { text: 'راجع الأرقام' })).s === 201);
ck('comment with an @mention', (await admin.post(`/tasks/${taskId}/comments`, { body: `Please review @sara_${run}` })).s === 201);
const mine = await employee.get('/tasks/mine');
const mineList = mine.b?.data?.items ?? mine.b?.data ?? [];
ck('the employee sees the assigned task in My Tasks', mine.s === 200 && JSON.stringify(mineList).includes(taskId), String(mine.s));
const notes = await employee.get('/notifications');
ck('the employee was notified (assignment / mention)', notes.s === 200 && JSON.stringify(notes.b).includes(taskId), String(notes.s));
const done = columns.find((c) => c.category === 'DONE');
const moved = await admin.patch(`/tasks/${taskId}/move`, { columnId: done?.id });
ck('move the task to Done', moved.s === 200, String(moved.s));
const search = await admin.get(`/search?q=${encodeURIComponent('تقرير المبيعات')}`);
ck('Arabic search finds the task', JSON.stringify(search.b).includes(taskId));
const key = randomUUID();
const once = { title: `Offline retry ${run}`, projectId, columnId: columns[0]?.id };
const first = await admin.post('/tasks', once, { 'idempotency-key': key });
const retry = await admin.post('/tasks', once, { 'idempotency-key': key });
ck('a retried request never creates a duplicate (Idempotency-Key)', first.s === 201 && retry.b?.data?.id === first.b?.data?.id && retry.h.get('idempotent-replay') === 'true');

// ------------------------------------------------------------------ recurring tasks
section('Recurring tasks');
// Dates a month ahead, so "never create an already-overdue copy" doesn't move them.
const dayKey = (d) => d.toISOString().slice(0, 10);
const plusDays = (key, n) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return dayKey(d); };
const ahead = plusDays(dayKey(new Date()), 30);
/** The last Friday of the month `monthsOn` after the month of `key`. */
const lastFriday = (key, monthsOn = 0) => {
  const d = new Date(`${key}T00:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsOn + 1, 0));
  last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - 5 + 7) % 7));
  return dayKey(last);
};
const tasksOfProject = async () => (await admin.get(`/tasks?projectId=${projectId}`)).b?.data ?? [];
// Every task of a series links to its first task — the first one included, once it has a copy.
const copiesOf = async (seriesId) => (await tasksOfProject()).filter((t) => t.recurrenceParentId === seriesId && t.id !== seriesId);
const todo = columns.find((c) => c.category !== 'DONE');

const weeklyTitle = `تقرير السلامة الأسبوعي ${run}`;
const weekly = await admin.post('/tasks', {
  title: weeklyTitle, description: 'Walk the site — جولة الموقع', priority: 'HIGH', projectId, columnId: todo?.id, dueDate: ahead,
  tags: ['routine'], assigneeIds: [emp.b?.data?.id], recurrenceRule: { freq: 'WEEKLY', interval: 1 },
}, { 'idempotency-key': randomUUID() });
ck('create a weekly recurring task with assignees and tags (201)', weekly.s === 201 && weekly.b?.data?.recurrenceRule?.freq === 'WEEKLY', JSON.stringify(weekly.b));
const weeklyId = weekly.b?.data?.id;
const item = await admin.post(`/tasks/${weeklyId}/checklist`, { text: 'Fire exits' });
await admin.put(`/checklist/${item.b?.data?.id}`, { done: true });
ck('the employee completes it (move to Done)', (await employee.patch(`/tasks/${weeklyId}/move`, { columnId: done?.id })).s === 200);
let copies = await copiesOf(weeklyId);
const next = copies[0];
ck('completing it creates exactly one next copy', copies.length === 1, `${copies.length} copies`);
ck('the copy is due a week later, in an open column', next?.dueDate?.startsWith(plusDays(ahead, 7)) && next?.columnId !== done?.id, `${next?.dueDate} ${next?.columnId}`);
ck('the copy keeps the title, description and priority', next?.title === weeklyTitle && next?.description === 'Walk the site — جولة الموقع' && next?.priority === 'HIGH');
const nextPeople = (await admin.get(`/tasks/${next?.id}/assignees`)).b?.data ?? [];
ck('the copy keeps the assignees', nextPeople.some((u) => u.id === emp.b?.data?.id), JSON.stringify(nextPeople));
const nextTags = (await admin.get(`/tasks/${next?.id}/tags`)).b?.data ?? [];
ck('the copy keeps the tags', nextTags.some((t) => t.name === 'routine'), JSON.stringify(nextTags));
const nextList = (await admin.get(`/tasks/${next?.id}/checklist`)).b?.data;
ck('the copy has the checklist, unticked', nextList?.total === 1 && nextList?.done === 0, JSON.stringify(nextList));
const original = (await admin.get(`/tasks/${weeklyId}`)).b?.data;
ck('the repeat moved to the new copy; the first task stays in the series', !original?.recurrenceRule && original?.recurrenceParentId === weeklyId && next?.recurrenceRule?.freq === 'WEEKLY');
await admin.patch(`/tasks/${weeklyId}/move`, { columnId: todo?.id });
await admin.patch(`/tasks/${weeklyId}/move`, { columnId: done?.id });
ck('reopening and completing the old one again makes no second copy', (await copiesOf(weeklyId)).length === 1);
ck('the API says which copy came next', (await admin.get(`/tasks/${weeklyId}`)).b?.data?.recurrenceNextId === next?.id);
const fork = await admin.put(`/tasks/${weeklyId}`, { recurrenceRule: { freq: 'DAILY', interval: 1 } });
ck('a repeat on an earlier copy is refused — no second, parallel series (409)', fork.s === 409 && fork.b?.error?.code === 'RECURRENCE_NOT_NEWEST', `${fork.s} ${JSON.stringify(fork.b)}`);
const offAgain = await admin.put(`/tasks/${next?.id}`, { recurrenceRule: null });
const onAgain = await admin.put(`/tasks/${next?.id}`, { recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
ck('the newest copy can switch its repeat off and back on', offAgain.s === 200 && onAgain.s === 200 && onAgain.b?.data?.recurrenceRule?.freq === 'WEEKLY', `${offAgain.s}/${onAgain.s}`);

const daily = await admin.post('/tasks', { title: `Daily check ${run}`, projectId, columnId: todo?.id, dueDate: ahead, recurrenceRule: { freq: 'DAILY', interval: 1 } });
const dailyId = daily.b?.data?.id;
const moves = await Promise.all([admin, employee, admin].map((c) => c.patch(`/tasks/${dailyId}/move`, { columnId: done?.id })));
ck('completed from three apps at the same moment → one copy', moves.every((m) => m.s === 200) && (await copiesOf(dailyId)).length === 1, `${moves.map((m) => m.s)} / ${(await copiesOf(dailyId)).length}`);

const monthEnd = lastFriday(ahead);
const monthly = await admin.post('/tasks', {
  title: `Month-end close ${run}`, projectId, columnId: todo?.id, dueDate: monthEnd,
  recurrenceRule: { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } },
});
ck('a custom schedule: monthly on the last Friday (201)', monthly.s === 201, JSON.stringify(monthly.b));
await admin.patch(`/tasks/${monthly.b?.data?.id}/move`, { columnId: done?.id });
const monthlyNext = (await copiesOf(monthly.b?.data?.id))[0];
ck('its next copy is due on the next month’s last Friday', monthlyNext?.dueDate?.startsWith(lastFriday(monthEnd, 1)), `${monthlyNext?.dueDate} vs ${lastFriday(monthEnd, 1)}`);
const tenth = `${ahead.slice(0, 8)}10`;
const twentieth = await admin.post('/tasks', { title: `Monthly on the 20th ${run}`, projectId, columnId: todo?.id, dueDate: tenth, recurrenceRule: { freq: 'MONTHLY', interval: 1, dayOfMonth: 20 } });
await admin.patch(`/tasks/${twentieth.b?.data?.id}/move`, { columnId: done?.id });
const twentiethNext = (await copiesOf(twentieth.b?.data?.id))[0];
ck('"monthly on the 20th" due the 10th is next due the 20th of the same month', twentiethNext?.dueDate?.startsWith(`${ahead.slice(0, 8)}20`), twentiethNext?.dueDate);
ck('an impossible schedule is refused (400)', (await admin.post('/tasks', { title: 'x', projectId, columnId: todo?.id, recurrenceRule: { freq: 'WEEKLY', interval: 1, nthWeekday: { week: 1, day: 1 } } })).s === 400);

ck('deleting just the newest copy (204)…', (await admin.del(`/tasks/${next?.id}`)).status === 204);
copies = await copiesOf(weeklyId);
ck('…skips it: the series carries on with the following week', copies.length === 1 && copies[0].id !== next?.id && copies[0].dueDate?.startsWith(plusDays(ahead, 14)) && copies[0].recurrenceRule?.freq === 'WEEKLY', JSON.stringify(copies.map((c) => c.dueDate)));
ck('deleting the entire series (204)…', (await admin.del(`/tasks/${copies[0]?.id}?scope=series`)).status === 204);
ck('…removes every copy', (await tasksOfProject()).every((t) => t.id !== weeklyId && t.recurrenceParentId !== weeklyId));

// ------------------------------------------------------------------ files
section('Attachments');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fdImg = new FormData();
fdImg.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
const img = await admin.upload(`/tasks/${taskId}/attachments`, fdImg);
ck('upload an image (201)', img.s === 201, JSON.stringify(img.b));
const imgServed = img.b?.data?.url ? await fetch(`${ORIGIN}${img.b.data.url}`) : null;
ck('the image downloads byte-for-byte', !!imgServed && imgServed.status === 200 && Buffer.from(await imgServed.arrayBuffer()).equals(png));
const fdHtml = new FormData();
fdHtml.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/plain' }), 'report.html');
const html = await admin.upload(`/tasks/${taskId}/attachments`, fdHtml);
const htmlServed = html.b?.data?.url ? await fetch(`${ORIGIN}${html.b.data.url}`) : null;
ck('a disguised .html upload is stored safely and served sandboxed',
  html.s === 201 && /\.txt$/.test(html.b.data.url) && htmlServed?.headers.get('content-disposition') === 'attachment' && /sandbox/.test(htmlServed?.headers.get('content-security-policy') ?? ''),
  `${html.s} ${html.b?.data?.url}`);

// ------------------------------------------------------------------ reports
section('Reports');
const csv = await admin.raw('/reports/projects.csv');
const csvBytes = Buffer.from(await csv.arrayBuffer());
ck('CSV export (UTF-8 with BOM for Excel, Arabic intact)', csv.status === 200 && csvBytes.subarray(0, 3).toString('hex') === 'efbbbf' && csvBytes.toString('utf8').includes('مشروع الإطلاق'));
const pdf = await admin.raw('/reports/status.pdf');
const pdfBytes = Buffer.from(await pdf.arrayBuffer());
ck('PDF export', pdf.status === 200 && pdfBytes.subarray(0, 5).toString() === '%PDF-', String(pdf.status));
const xls = await admin.raw('/reports/workload.xls');
ck('Excel export', xls.status === 200 && (await xls.text()).includes('Workbook'), String(xls.status));
ck('employees cannot export reports (403)', (await employee.raw('/reports/projects.csv')).status === 403);
const fullX = await admin.raw(`/reports/export.xlsx?projectId=${projectId}`);
const fullXBytes = Buffer.from(await fullX.arrayBuffer());
const fullParts = unzipText(fullXBytes);
const sheetNames = [...(fullParts.get('xl/workbook.xml') ?? '').matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
const tasksSheet = fullParts.get(`xl/worksheets/sheet${sheetNames.indexOf('Tasks') + 1}.xml`) ?? '';
ck('full report → Excel (.xlsx): a sheet per section, the project filter applied, Arabic intact',
  fullX.status === 200 && JSON.stringify(sheetNames) === JSON.stringify(['Summary', 'Status', 'Projects', 'Team workload', 'Trend', 'Tasks'])
    && tasksSheet.includes(arTitle) && [...tasksSheet.matchAll(/>([A-Z][A-Z0-9]*)-\d+</g)].every((m) => m[1] === project.b?.data?.code) && (fullParts.get('xl/worksheets/sheet1.xml') ?? '').includes('Project: '),
  `${fullX.status} ${JSON.stringify(sheetNames)}`);
ck('…named after the report, its filter and the day', new RegExp(`^tasks-report-${run}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`).test(fileName(fullX)), fileName(fullX));
const fullP = await admin.raw(`/reports/export.pdf?projectId=${projectId}&from=2026-09-01&to=2026-09-30`);
const fullPBytes = Buffer.from(await fullP.arrayBuffer());
ck('full report → branded PDF (logo embedded)', fullP.status === 200 && fullPBytes.subarray(0, 5).toString() === '%PDF-' && fullPBytes.includes('/Subtype /Image'), String(fullP.status));
ck('single reports also as .xlsx', (await admin.raw('/reports/projects.xlsx')).headers.get('content-type')?.includes('spreadsheetml') === true);
ck('employees cannot export the full report (403)', (await employee.raw('/reports/export.pdf')).status === 403);
const taskX = await employee.raw(`/tasks/${taskId}/export.xlsx`);
const taskParts = unzipText(Buffer.from(await taskX.arrayBuffer()));
ck('a task → Excel, by anyone who can open it (its assignee)',
  taskX.status === 200 && (taskParts.get('xl/worksheets/sheet1.xml') ?? '').includes(arTitle) && fileName(taskX).startsWith(`${back.b?.data?.key}-`),
  `${taskX.status} ${fileName(taskX)}`);
const taskP = await admin.raw(`/tasks/${taskId}/export.pdf`);
ck('a task → PDF', taskP.status === 200 && Buffer.from(await taskP.arrayBuffer()).subarray(0, 5).toString() === '%PDF-', String(taskP.status));
ck('an unknown task cannot be exported (404)', (await admin.raw('/tasks/nope/export.pdf')).status === 404);

// ------------------------------------------------------------------ chat + realtime
section('Chat and live updates');
const chan = await admin.get(`/projects/${projectId}/chat`);
const convId = chan.b?.data?.conversation?.id ?? chan.b?.data?.id;
ck('the project has a chat channel', chan.s === 200 && !!convId, JSON.stringify(chan.b));
const socket = io(ORIGIN, { auth: { token: empLogin.b?.data?.accessToken }, transports: ['websocket'], reconnection: false });
const connected = await new Promise((resolve) => {
  socket.on('connect', () => resolve(true));
  socket.on('connect_error', () => resolve(false));
  setTimeout(() => resolve(false), 8000);
});
ck('realtime socket connects (same address)', connected);
const heard = new Promise((resolve) => {
  socket.onAny((event, payload) => {
    if (JSON.stringify(payload ?? '').includes('مرحبا')) resolve(true);
  });
  setTimeout(() => resolve(false), 8000);
});
if (connected) socket.emit('join', { projectId });
await new Promise((r) => setTimeout(r, 500));
const msg = await admin.post(`/conversations/${convId}/messages`, { body: `مرحبا بالفريق ${run}` });
ck('send an Arabic chat message (201)', msg.s === 201, JSON.stringify(msg.b));
ck('the employee receives it live', await heard);
socket.close();
const history = await employee.get(`/conversations/${convId}/messages`);
ck('the employee reads the message history', history.s === 200 && JSON.stringify(history.b).includes(`مرحبا بالفريق ${run}`), String(history.s));

// ------------------------------------------------------------------ meetings
section('Meetings');
const start = new Date(Date.now() + 86_400_000);
const meeting = await admin.post('/meetings', { title: `اجتماع مراجعة ${run}`, description: 'مناقشة الميزانية', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), projectId });
ck('schedule a meeting (201)', meeting.s === 201, JSON.stringify(meeting.b?.error ?? ''));
await admin.post(`/meetings/${meeting.b?.data?.id}/notes`, { type: 'DECISION', body: 'تمت الموافقة على الميزانية' });
const scratch = await admin.post(`/meetings/${meeting.b?.data?.id}/notes`, { type: 'DISCUSSION', body: `ملاحظة مؤقتة ${run}` });
const noteUrl = `/meetings/${meeting.b?.data?.id}/notes/${scratch.b?.data?.id}`;
const deleted = await admin.del(noteUrl);
const afterDelete = await admin.get(`/meetings/${meeting.b?.data?.id}/notes`);
const restored = await admin.post(`${noteUrl}/restore`, {});
const afterRestore = await admin.get(`/meetings/${meeting.b?.data?.id}/notes`);
ck('a deleted meeting note can be restored (Undo)',
  deleted.status === 204 && !JSON.stringify(afterDelete.b).includes(`ملاحظة مؤقتة ${run}`) && restored.s === 200 && JSON.stringify(afterRestore.b).includes(`ملاحظة مؤقتة ${run}`),
  `${deleted.status} ${restored.s}`);
const minutes = await admin.raw(`/meetings/${meeting.b?.data?.id}/minutes.pdf`);
const minutesBytes = Buffer.from(await minutes.arrayBuffer());
ck('minutes PDF with the Arabic font', minutes.status === 200 && minutesBytes.subarray(0, 5).toString() === '%PDF-' && /NotoNaskhArabic/.test(minutesBytes.toString('latin1')));

// ------------------------------------------------------------------ admin surfaces
section('Administration');
ck('dashboard statistics load', (await admin.get('/reports/status')).s === 200);
ck('system settings load (admin)', (await admin.get('/system-settings')).s === 200);
const audit = await admin.get('/audit-logs');
ck('audit log records activity', audit.s === 200 && JSON.stringify(audit.b).includes(`sara_${run}`), String(audit.s));
ck('employees cannot open system settings (403)', (await employee.get('/system-settings')).s === 403);
const myData = await employee.raw("/users/me/export");
const myDataJson = myData.status === 200 ? await myData.json().catch(() => null) : null;
ck('an employee downloads their own data',
  myData.status === 200 && /attachment; filename="mico360-my-data-/.test(myData.headers.get('content-disposition') ?? '') && myDataJson?.profile?.username === `sara_${run}` && JSON.stringify(myDataJson?.tasksAssignedToMe ?? []).includes(arTitle),
  `${myData.status}`);
const out = await fetch(`${B}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: empLogin.b?.data?.refreshToken }) });
ck('sign-out revokes the session', out.status === 200 || out.status === 204);

console.log(`\n${fail ? 'FAILURES' : 'ALL PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
