// The live company access matrix (MC1 Task 17): builds the two-company world on a running server
// (company-world.mjs) and walks the route-class table over HTTP and sockets. A FAIL is a leak (or a
// pick that widened); every check prints PASS — … or FAIL — …, and the script exits 1 on any FAIL.
//
//   E2E_BASE           http://localhost:4601/api/v1
//   E2E_BACKEND_DIST   …/Web Portal/backend/dist  (route-classes, pdf/xlsx readers, socket.io-client)
//   E2E_OUTBOX         the server's test mailbox (start.mjs: t1181/runs/<folder>/outbox)
//   E2E_WORLD          a world JSON printed by company-world.mjs (else a new world is made)
//
// (a) every `list` and `people` GET: no foreign marker for ana, ben, bob, cat (no pick, pick A, pick B), gus;
//     exports and PDFs read as text; routes with an :id are asked with the persona's own and foreign ids.
// (b) every `object` GET with a foreign id → 403/404 (400 is a refusal too: nothing is read).
// (c) a foreign pick on every `list` GET → 403 (never widened).
// (d) sockets: joins, live events, and a company removed while connected.
// (e) emails: cat's grouped morning email preview; the MA invitation's company name.
// (f) the meeting-invitation exception, over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { client, seedCompanyWorld } from './company-world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE ?? 'http://localhost:4601/api/v1';
const ORIGIN = new URL(BASE).origin;
const DIST = path.resolve(process.env.E2E_BACKEND_DIST ?? path.join(HERE, '..', 'dist'));
const OUTBOX = process.env.E2E_OUTBOX ?? null;
const require = createRequire(path.join(HERE, '..', 'package.json'));
const { ROUTE_CLASSES } = require(path.join(DIST, 'src', 'modules', 'companies', 'route-classes.js'));
const { inspectPdf } = require(path.join(DIST, 'src', 'lib', 'pdf-inspect.js'));
const { inspectXlsx } = require(path.join(DIST, 'src', 'lib', 'xlsx-inspect.js'));
const { io } = require('socket.io-client');

let failures = 0;
let passes = 0;
const ck = (name, ok, detail = '') => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${!ok && detail ? ` | ${String(detail).slice(0, 400)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = client(BASE);
const world = process.env.E2E_WORLD ? JSON.parse(fs.readFileSync(process.env.E2E_WORLD, 'utf8')) : await seedCompanyWorld(BASE);
console.log(`world ${world.tag}: ${JSON.stringify({ companies: world.companies, projects: world.projects })}`);
const { companies: CO, people: PE, projects: PR, tasks: TK, meetings: MT, chats: CH } = world;
const tokens = { admin: await c.login(process.env.E2E_ADMIN ?? 'admin@mico360.test', world.password) };
for (const n of Object.keys(PE)) tokens[n] = await c.login(world.emails[n], world.password);

/** A response as text: JSON, CSV, an xlsx workbook's cells or a PDF's text. */
function textOf(r) {
  if (r.type.includes('pdf') || r.buf.subarray(0, 4).toString() === '%PDF') {
    try {
      return inspectPdf(r.buf).pages.flat().join('\n');
    } catch (err) {
      return `<<pdf unreadable: ${err.message}>>`;
    }
  }
  if (r.type.includes('spreadsheet') || r.buf.subarray(0, 2).toString() === 'PK') {
    try {
      return inspectXlsx(r.buf).text.flat().join('\n');
    } catch (err) {
      return `<<xlsx unreadable: ${err.message}>>`;
    }
  }
  return r.buf.toString('utf8');
}

const today = new Date().toISOString().slice(0, 10);
const shift = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const QUERY = {
  '/calendar': `?from=${shift(-30)}&to=${shift(30)}`,
  '/timeline': `?from=${shift(-30)}&to=${shift(60)}`,
  '/workload': `?week=${today}`,
  '/management/items': '?metric=late-tasks',
  '/search': '?q=ZZ',
  '/search/tasks': '?q=ZZ',
  '/chat/search': '?q=ZZ',
  '/reports/timeseries': `?from=${shift(-60)}&to=${today}`,
};
const REPORT_KEYS = ['status', 'projects', 'workload'];
/** Concrete URLs for one route path (template paths expanded, params from the ids given). */
function urlsOf(p, ids) {
  let paths = [p];
  if (p.includes('${def.key}')) paths = REPORT_KEYS.map((k) => p.replace('${def.key}', k));
  if (p.includes('${format}')) paths = paths.flatMap((x) => ['xlsx', 'pdf'].map((f) => x.replace('${format}', f)));
  const out = [];
  for (const x of paths) {
    let ok = true;
    const filled = x.replace(/:([A-Za-z]+)/g, (_m, name) => {
      const v = ids(x, name);
      if (!v) ok = false;
      return v ?? '';
    });
    if (ok) out.push(filled);
  }
  return out.map((u) => (u.startsWith('/api/v1') ? u.slice('/api/v1'.length) : u) + (QUERY[u] ?? (u.startsWith('/timeline/projects/') ? QUERY['/timeline'] : '')));
}
const kindOf = (p) => (p.startsWith('/projects/') || p.startsWith('/timeline/projects/') || p.includes('/from-project/') ? 'project' : p.startsWith('/tasks/') ? 'task' : p.startsWith('/meetings/') ? 'meeting' : p.startsWith('/conversations/') ? 'chat' : p.startsWith('/attachments/') ? 'attachment' : null);
const routes = Object.entries(ROUTE_CLASSES).map(([k, cls]) => ({ method: k.split(' ')[0], path: k.slice(k.indexOf(' ') + 1), cls }));
const gets = (cls) => routes.filter((r) => r.method === 'GET' && cls.includes(r.cls));

// ── personas: what is theirs, what is foreign, which markers they must never see ──
const ALL = ['ZZALPHA', 'ZZBETA', 'ZZGAMMA', 'ZZSHARED', 'ZZMEETA', 'ZZDIRECT', 'ZZCATANA', 'Alphaonly', 'Betaonly'];
const PERSONAS = [
  { name: 'ana', own: { project: PR.PA, task: TK.TA1, meeting: MT.MA, chat: CH.PA }, foreign: { project: PR.PB, task: TK.TB1, meeting: MT.MB, chat: CH.PB }, markers: ['ZZBETA', 'ZZGAMMA', 'Gammaonly'], picks: [null], foreignPick: CO.B },
  { name: 'ben', own: { project: PR.PB, task: TK.TB1, meeting: MT.MB, chat: CH.PB }, foreign: { project: PR.PA, task: TK.TA1, meeting: MT.MA, chat: CH.PA, attachment: world.attachments.TA1 }, markers: ['ZZALPHA', 'ZZGAMMA', 'ZZMEETA', 'ZZCATANA', 'Alphaonly', 'Gammaonly'], picks: [null], foreignPick: CO.A },
  { name: 'bob', own: { meeting: MT.MA }, foreign: { project: PR.PA, task: TK.TA1, meeting: MT.MB, chat: CH.PA, attachment: world.attachments.TA1 }, markers: ['ZZALPHA', 'ZZSHARED', 'ZZGAMMA', 'ZZDIRECT', 'ZZCATANA', 'Alphaonly', 'Gammaonly'], picks: [null], foreignPick: CO.A },
  { name: 'cat', own: { project: PR.PA, task: TK.TA2, meeting: MT.MA, chat: CH.PA }, foreign: { project: PR.PAB, task: TK.TAB1, meeting: MT.MN_A, chat: CH.PAB }, markers: ['ZZGAMMA', 'ZZSHARED', 'ZZDIRECT', 'Gammaonly'], picks: [null, CO.A, CO.B], pickMarkers: { [CO.A]: ['ZZBETA'], [CO.B]: ['ZZALPHA', 'ZZMEETA'] }, foreignPick: CO.C },
  { name: 'gus', own: {}, foreign: { project: PR.PC, task: TK.TC1, meeting: MT.MA, chat: CH.PC, attachment: world.attachments.TA1 }, markers: ALL, picks: [null], foreignPick: CO.C },
  // An administrator sees everything; with a pick, every list (reports and exports included) holds only
  // that company's projects: with Alpha picked nothing of Beta's or Gamma's. (Only (a) runs for them.)
  { name: 'admin', own: { project: PR.PA, task: TK.TA1, meeting: MT.MA, chat: CH.PA }, foreign: {}, markers: [], picks: [CO.A], pickMarkers: { [CO.A]: ['ZZBETA', 'ZZGAMMA'] }, onlyLists: true },
];

// ── (e) emails first (before (d) changes cat's companies) ──
{
  const r = await c.call(tokens.admin, 'GET', `/admin/daily-emails/preview?userId=${PE.cat}&kind=PENDING`);
  const text = textOf(r);
  const a = text.indexOf(`Alpha ${world.tag}`);
  const b = text.indexOf(`Beta ${world.tag}`);
  ck('(e) cat’s morning email preview: Alpha’s heading, then Beta’s', r.status === 200 && a >= 0 && b > a, `status ${r.status}; alpha@${a} beta@${b}; ${text.slice(0, 300)}`);
  ck('(e) cat’s morning email: nothing of PAB or Gamma', !/ZZSHARED|ZZGAMMA/.test(text), text.match(/ZZSHARED|ZZGAMMA/)?.[0]);
  if (OUTBOX) {
    const before = new Set(fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []);
    const sent = await c.call(tokens.ana, 'POST', `/meetings/${MT.MA}/invites`, {});
    await sleep(1500);
    const fresh = (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []).filter((f) => !before.has(f)).map((f) => fs.readFileSync(path.join(OUTBOX, f), 'utf8'));
    const toBob = fresh.find((m) => m.includes(world.emails.bob)) ?? '';
    ck('(e) the MA invitation is sent, and names Alpha (2+ companies)', sent.status === 200 && toBob.includes(`Alpha ${world.tag}`), `status ${sent.status}; ${fresh.length} new emails; bob's: ${toBob.slice(0, 200)}`);
  } else console.log('NOTE — (e) the invitation email check needs E2E_OUTBOX');
}

// ── (a) list and people GETs: no foreign marker ──
for (const p of PERSONAS) {
  const idsFor = (which) => (route, name) => {
    const k = kindOf(route);
    if (name === 'userId') return null;
    return k ? p[which][k] ?? null : null;
  };
  for (const pick of p.picks) {
    const markers = [...p.markers, ...(pick ? p.pickMarkers?.[pick] ?? [] : [])];
    const re = new RegExp(markers.join('|'));
    const headers = pick ? { 'x-company-id': pick } : {};
    for (const r of gets(p.onlyLists ? ['list'] : ['list', 'people'])) {
      for (const which of ['own', 'foreign']) {
        if (which === 'foreign' && !/:[A-Za-z]+/.test(r.path)) continue;
        for (const url of urlsOf(r.path, idsFor(which))) {
          const res = await c.call(tokens[p.name], 'GET', url, undefined, headers);
          const text = textOf(res);
          const hit = text.match(re)?.[0];
          const label = `(a) ${p.name}${pick ? ` pick ${pick === CO.A ? 'A' : pick === CO.B ? 'B' : 'C'}` : ''} ${r.cls} GET ${url} [${which}] ${res.status}`;
          ck(label, !hit && res.status < 500, hit ? `shows ${hit}: …${text.slice(Math.max(0, text.indexOf(hit) - 120), text.indexOf(hit) + 80)}…` : `status ${res.status}`);
        }
      }
    }
  }
}

// ── (b) object GETs with a foreign id ──
for (const p of PERSONAS.filter((x) => !x.onlyLists)) {
  for (const r of gets(['object', 'list', 'people'])) {
    if (!/:[A-Za-z]+/.test(r.path) || r.path.startsWith('/client/')) continue;
    const k = kindOf(r.path);
    if (!k || !p.foreign[k]) continue;
    for (const url of urlsOf(r.path, (_route, name) => (name === 'userId' ? null : p.foreign[k]))) {
      const res = await c.call(tokens[p.name], 'GET', url);
      ck(`(b) ${p.name} GET ${url} (foreign ${k}) → ${res.status}`, [400, 403, 404].includes(res.status), textOf(res).slice(0, 200));
    }
  }
}

// ── (c) a foreign pick on every list GET ──
for (const p of PERSONAS.filter((x) => x.foreignPick)) {
  for (const r of gets(['list'])) {
    for (const url of urlsOf(r.path, (route) => (kindOf(route) ? p.own[kindOf(route)] ?? null : null))) {
      const res = await c.call(tokens[p.name], 'GET', url, undefined, { 'x-company-id': p.foreignPick });
      const code = res.json?.error?.code;
      ck(`(c) ${p.name} foreign pick GET ${url} → ${res.status} ${code ?? ''}`, res.status === 403, textOf(res).slice(0, 200));
    }
  }
}

// ── (f) the meeting-invitation exception (bob on MA) ──
{
  const get = (who, url) => c.call(tokens[who], 'GET', url);
  const m = await get('bob', `/meetings/${MT.MA}`);
  ck('(f) bob opens MA in the invitee view', m.status === 200 && m.json?.data?.view === 'invitee', `${m.status} ${JSON.stringify(m.json?.data?.view)}`);
  const notes = await get('bob', `/meetings/${MT.MA}/notes`);
  ck('(f) MA’s notes stay with the team (403 INVITEE_ONLY)', notes.status === 403 && notes.json?.error?.code === 'INVITEE_ONLY', `${notes.status} ${notes.json?.error?.code}`);
  ck('(f) no minutes PDF before they are final (404)', (await get('bob', `/meetings/${MT.MA}/minutes.pdf`)).status === 404);
  const items = await get('bob', `/meetings/${MT.MA}/action-items`);
  ck('(f) bob sees his own action item only', items.status === 200 && textOf(items).includes('ZZMEETA action for bob') && !textOf(items).includes('ZZALPHA'), textOf(items).slice(0, 300));
  const final = { summary: 'Agreed ZZMEETA final', discussion: [], decisions: ['Go ahead'], risks: [], nextSteps: [] };
  const approve = await c.call(tokens.ana, 'POST', `/meetings/${MT.MA}/final-minutes/approve`, { content: final });
  ck('(f) ana marks MA’s minutes final', approve.status === 200, textOf(approve).slice(0, 200));
  const pdf = await get('bob', `/meetings/${MT.MA}/minutes.pdf`);
  const text = textOf(pdf);
  ck('(f) bob’s minutes PDF: final minutes and his item, no live notes or ana’s item', pdf.status === 200 && text.includes('Agreed ZZMEETA final') && text.includes('ZZMEETA action for bob') && !/ZZALPHA/.test(text), `${pdf.status} ${text.match(/ZZALPHA[^\n]*/)?.[0] ?? ''}`);
  for (const url of [`/projects/${PR.PA}`, `/tasks/${TK.TA1}`, `/projects/${PR.PA}/members`, `/conversations/${CH.PA}/messages`]) {
    const r = await get('bob', url);
    ck(`(f) bob can’t open the rest of PA: GET ${url} → ${r.status}`, [403, 404].includes(r.status));
  }
  if (OUTBOX) {
    const before = new Set(fs.readdirSync(OUTBOX));
    const sent = await c.call(tokens.ana, 'POST', `/meetings/${MT.MA}/minutes/send`, {});
    await sleep(1500);
    const mails = fs.readdirSync(OUTBOX).filter((f) => !before.has(f)).map((f) => fs.readFileSync(path.join(OUTBOX, f)));
    const toBob = mails.find((m) => m.toString('latin1').includes(world.emails.bob));
    // The attachment is base64 in the saved email; decode it and read the PDF.
    let attached = '';
    if (toBob) {
      const raw = toBob.toString('latin1');
      const b64 = raw.match(/application\/pdf[\s\S]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/)?.[1] ?? raw.match(/"content"\s*:\s*"([A-Za-z0-9+/=]+)"/)?.[1] ?? '';
      try {
        attached = b64 ? inspectPdf(Buffer.from(b64.replace(/\s+/g, ''), 'base64')).pages.flat().join('\n') : '';
      } catch {
        attached = '';
      }
    }
    ck('(f) the minutes email gives bob his own copy (no live notes, no ana’s item)', sent.status === 200 && !!toBob && (attached ? !/ZZALPHA/.test(attached) && attached.includes('ZZMEETA action for bob') : !toBob.toString('latin1').includes('ZZALPHA note')), `status ${sent.status}; to bob: ${!!toBob}; pdf read: ${!!attached}; ${attached.match(/ZZALPHA[^\n]*/)?.[0] ?? ''}`);
  }
  await c.call(tokens.ana, 'POST', `/meetings/${MT.MA}/final-minutes/reopen`, {});
}

// ── (d) sockets ──
{
  const connect = (who) =>
    new Promise((resolve, reject) => {
      const s = io(ORIGIN, { auth: { token: tokens[who] }, transports: ['websocket'], reconnection: false });
      const events = [];
      s.onAny((event, payload) => events.push({ event, payload }));
      s.on('connect', () => resolve({ s, events }));
      s.on('connect_error', reject);
      setTimeout(() => reject(new Error(`${who}: no connection`)), 8000);
    });
  const wait = async (events, test, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const e = events.find(test);
      if (e) return e;
      await sleep(100);
    }
    return null;
  };
  const ana = await connect('ana');
  ana.s.emit('join', { projectId: PR.PB });
  ck('(d) ana’s join of PB → join:denied', !!(await wait(ana.events, (e) => e.event === 'join:denied' && e.payload?.projectId === PR.PB, 3000)));
  ana.s.emit('join', { projectId: PR.PA });
  await wait(ana.events, (e) => e.event === 'joined', 3000);
  const mark = ana.events.length;
  await c.call(tokens.admin, 'PUT', `/tasks/${TK.TB1}`, { title: 'TB1 ZZBETA task (edited)' });
  await sleep(1500);
  const heard = ana.events.slice(mark).filter((e) => JSON.stringify(e.payload ?? '').includes(TK.TB1) || /ZZBETA/.test(JSON.stringify(e.payload ?? '')));
  ck('(d) while the admin edits TB1, ana hears nothing of it', heard.length === 0, JSON.stringify(heard).slice(0, 300));

  const cat = await connect('cat');
  cat.s.emit('join', { projectId: PR.PB });
  ck('(d) cat joins PB', !!(await wait(cat.events, (e) => e.event === 'joined' && e.payload?.projectId === PR.PB, 3000)));
  const removed = await c.call(tokens.admin, 'POST', '/users/companies', { userIds: [PE.cat], removeCompanyIds: [CO.B] });
  ck('(d) admin takes cat out of Beta', removed.status === 200 && removed.json?.data?.changed === 1, textOf(removed).slice(0, 200));
  ck('(d) cat’s socket hears project:removed {PB} within 2 s', !!(await wait(cat.events, (e) => e.event === 'project:removed' && e.payload?.projectId === PR.PB, 2000)), JSON.stringify(cat.events.map((e) => e.event)));
  const after = await c.call(tokens.cat, 'GET', '/projects');
  ck('(d) her next GET /projects has no PB', after.status === 200 && !textOf(after).includes(PR.PB) && !/ZZBETA/.test(textOf(after)));
  const back = await c.call(tokens.admin, 'POST', '/users/companies', { userIds: [PE.cat], addCompanyIds: [CO.B] });
  await c.call(tokens.admin, 'PUT', `/users/${PE.cat}`, { primaryCompanyId: CO.B });
  ck('(d) cat is put back in Beta', back.status === 200);
  ana.s.close();
  cat.s.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
