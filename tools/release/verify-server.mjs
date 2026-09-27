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
const missing = await fetch(`${B}/no-such-endpoint`);
ck('unknown API paths answer JSON 404 (not the web page)', missing.status === 404 && (await missing.json().catch(() => ({}))).error?.code === 'NOT_FOUND');

section('Server status');
const health = await fetch(`${B}/health`).then(json);
ck('health check is ok', health.s === 200 && health.b?.data?.status === 'ok');
const config = await fetch(`${B}/config`).then(json);
ck('company time zone is Asia/Muscat', config.b?.data?.timeZone === 'Asia/Muscat', JSON.stringify(config.b));

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
const out = await fetch(`${B}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: empLogin.b?.data?.refreshToken }) });
ck('sign-out revokes the session', out.status === 200 || out.status === 204);

console.log(`\n${fail ? 'FAILURES' : 'ALL PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
