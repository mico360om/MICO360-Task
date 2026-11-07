// The companies test world (MC1), built through the HTTP API of a running server — the same world as
// tests/integration/company-world.ts, for the live access matrix (company-matrix.e2e.mjs) and the
// website/app checks (MC2/MC3).
//
//   node e2e/company-world.mjs            → builds it and prints the ids as JSON (last line)
//   import { seedCompanyWorld } from './company-world.mjs'
//
// E2E_BASE (default http://localhost:4601/api/v1); the administrator is the demo seed's
// admin@mico360.test / Password1! (E2E_ADMIN / E2E_PASSWORD).
//
//   Companies  A "Alpha <tag>" (with a logo), B "Beta <tag>", C "Gamma <tag>" (archived at the end).
//   People     ana (A), amy (A, "Amy Alphaonly"), ben (B), bob (B, "Bob Betaonly"), cat (A+B, primary B),
//              gus (C only, "Gus Gammaonly"); password Password1!.
//   Projects   PA (A; ana, cat), PB (B; owner ben, cat), PAB (A+B, main A; ana, ben), PC (C; gus).
//   Tasks      TA1 (PA, ana; a file alpha-ZZALPHA.pdf), TA2 (PA, cat), TB1 (PB, ben), TB2 (PB, cat),
//              TAB1 (PAB, ben), TC1 (PC, gus); one comment each by its assignee.
//   Meetings   MA (PA; organizer ana; ana + bob invited while bob was still in Alpha; a note; action
//              items for ana and bob), MB (PB, ben), MN_A (no project, A; amy + ana), MN_B (no project, B; ben).
//   Chats      direct ana–amy, ana–ben (from when ben was in Alpha too), cat–ana; channels PA, PB, PAB, PC.
// Markers: PA / Alpha-only texts ZZALPHA; PB ZZBETA; PC ZZGAMMA; PAB ZZSHARED; what bob may see of MA
// (its title, his own action item) ZZMEETA; the ana–ben chat ZZDIRECT, the cat–ana chat ZZCATANA. Project and
// company names hold none.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASSWORD = 'Password1!';
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const PDF_TINY = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

export function client(base) {
  async function call(token, method, url, body, headers = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, buf, type: res.headers.get('content-type') ?? '', headers: res.headers };
  }
  const ok = async (p, what) => {
    const r = await p;
    if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.buf.toString('utf8').slice(0, 300)}`);
    return r.json?.data;
  };
  async function login(identifier, password = PASSWORD) {
    const r = await call(null, 'POST', '/auth/login', { identifier, password });
    if (r.status !== 200) throw new Error(`login ${identifier}: ${r.status} ${r.buf.toString('utf8').slice(0, 200)}`);
    return r.json.data.accessToken;
  }
  const file = (name, type, content) => {
    const form = new FormData();
    form.append('file', new Blob([content], { type }), name);
    return form;
  };
  return { call, ok, login, file };
}

export async function seedCompanyWorld(base = process.env.E2E_BASE ?? 'http://localhost:4601/api/v1', adminToken = null) {
  const c = client(base);
  const tag = randomBytes(3).toString('hex');
  const T = tag.toUpperCase();
  const admin = adminToken ?? (await c.login(process.env.E2E_ADMIN ?? 'admin@mico360.test', process.env.E2E_PASSWORD ?? PASSWORD));
  const as = (token) => ({
    get: (url, h) => c.ok(c.call(token, 'GET', url, undefined, h), `GET ${url}`),
    post: (url, body = {}, h) => c.ok(c.call(token, 'POST', url, body, h), `POST ${url}`),
    put: (url, body = {}, h) => c.ok(c.call(token, 'PUT', url, body, h), `PUT ${url}`),
  });
  const A0 = as(admin);

  // Companies (C stays active until its people and project are made; archived at the end).
  const company = async (name, letter) => (await A0.post('/companies', { name: `${name} ${tag}`, code: `${letter}${T}` })).id;
  const companies = { A: await company('Alpha', 'A'), B: await company('Beta', 'B'), C: await company('Gamma', 'C') };
  await c.ok(c.call(admin, 'POST', `/companies/${companies.A}/logo`, c.file('alpha-logo.png', 'image/png', PNG_1PX)), 'Alpha logo');

  // People. ben and bob start in Alpha too (ana chats with ben and invites bob to MA while they share
  // it), and leave Alpha before the end — as people who move between companies do.
  const person = async (name, last, companyIds, primaryCompanyId) => {
    const id = (
      await A0.post('/users', {
        email: `${name}.${tag}@world.test`,
        username: `${name}_${tag}`,
        // 1.23.6: a password typed here is a temporary one (changed at the first sign-in, below).
        password: temporary,
        firstName: name.charAt(0).toUpperCase() + name.slice(1),
        lastName: last,
        roleNames: ['EMPLOYEE'],
        companyIds,
        ...(primaryCompanyId ? { primaryCompanyId } : {}),
      })
    ).id;
    // Onboarding: a temporary-password account confirms its email with a code at its first sign-in when
    // the server can send email (a test server saves it to a folder). These are test people: the
    // administrator vouches for them (a server from before onboarding answers 404, which is fine).
    await c.call(admin, 'POST', `/users/${id}/email-verified`, { reason: 'e2e test person' });
    // 1.23.6: the first sign-in with a temporary password asks for their own (the website's step), so
    // each test person chooses the shared test password. An older server signs straight in: then the
    // administrator sets the test password instead.
    const first = await c.call(null, 'POST', '/auth/login', { identifier: `${name}.${tag}@world.test`, password: temporary, acceptChallenge: true, acceptPasswordChange: true });
    const step = first.json?.data?.changePassword;
    if (step) await c.ok(c.call(null, 'POST', '/auth/password/first-change', { ticket: step.ticket, password: PASSWORD }), `${name}: own password`);
    else await c.ok(c.call(admin, 'POST', `/users/${id}/password`, { password: PASSWORD }), `${name}: password`);
    return id;
  };
  const temporary = `Temp-${tag}-7k`;
  const people = {
    ana: await person('ana', `Alpha ${tag}`, [companies.A]),
    amy: await person('amy', 'Alphaonly', [companies.A]),
    ben: await person('ben', `Beta ${tag}`, [companies.B, companies.A], companies.B),
    bob: await person('bob', 'Betaonly', [companies.B, companies.A], companies.B),
    cat: await person('cat', `Both ${tag}`, [companies.B, companies.A], companies.B),
    gus: await person('gus', 'Gammaonly', [companies.C]),
  };
  const emails = Object.fromEntries(Object.keys(people).map((n) => [n, `${n}.${tag}@world.test`]));
  const tokens = {};
  for (const n of Object.keys(people)) tokens[n] = await c.login(emails[n]);
  const P = Object.fromEntries(Object.keys(people).map((n) => [n, as(tokens[n])]));

  // Projects (made by the administrator, in their companies).
  const project = async (code, companyIds, memberIds, extra = {}) =>
    (await A0.post('/projects', { code: `${code}${T}`, name: `Project ${code} ${tag}`, status: 'ACTIVE', companyIds, memberIds, ...extra })).id;
  const projects = {
    PA: await project('PA', [companies.A], [people.ana, people.cat]),
    PB: await project('PB', [companies.B], [people.cat], { ownerId: people.ben }),
    PAB: await project('PAB', [companies.A, companies.B], [people.ana, people.ben]),
    PC: await project('PC', [companies.C], [people.gus]),
  };
  const todo = {};
  for (const [k, id] of Object.entries(projects)) {
    const cols = await A0.get(`/projects/${id}/columns`);
    todo[k] = (cols.find((x) => x.category === 'TODO') ?? cols[0]).id;
  }

  // Tasks, each with a comment by its assignee.
  const task = async (name, p, who, marker) => {
    const t = await A0.post('/tasks', { title: `${name} ${marker} task`, description: `${marker} description`, projectId: projects[p], columnId: todo[p], assigneeIds: [people[who]] });
    await P[who].post(`/tasks/${t.id}/comments`, { body: `${marker} comment on ${name}` });
    return t.id;
  };
  const tasks = {
    TA1: await task('TA1', 'PA', 'ana', 'ZZALPHA'),
    TA2: await task('TA2', 'PA', 'cat', 'ZZALPHA'),
    TB1: await task('TB1', 'PB', 'ben', 'ZZBETA'),
    TB2: await task('TB2', 'PB', 'cat', 'ZZBETA'),
    TAB1: await task('TAB1', 'PAB', 'ben', 'ZZSHARED'),
    TC1: await task('TC1', 'PC', 'gus', 'ZZGAMMA'),
  };
  const attachment = await c.ok(c.call(tokens.ana, 'POST', `/tasks/${tasks.TA1}/attachments`, c.file('alpha-ZZALPHA.pdf', 'application/pdf', PDF_TINY)), 'TA1 file');

  // Meetings.
  const tomorrow = new Date(Date.now() + 2 * 86_400_000);
  tomorrow.setUTCHours(6, 0, 0, 0);
  const startAt = tomorrow.toISOString();
  const MA = (await P.ana.post('/meetings', { title: 'MA ZZMEETA meeting', projectId: projects.PA, startAt, attendees: [{ userId: people.ana }, { userId: people.bob }] })).id;
  const note = await P.ana.post(`/meetings/${MA}/notes`, { body: 'ZZALPHA note' });
  const items = {
    MA_ana: (await P.ana.post(`/meetings/${MA}/action-items`, { description: `ZZALPHA action for ana`, assigneeId: people.ana })).id,
    MA_bob: (await P.ana.post(`/meetings/${MA}/action-items`, { description: `ZZMEETA action for bob`, assigneeId: people.bob })).id,
  };
  const MB = (await P.ben.post('/meetings', { title: 'MB ZZBETA meeting', projectId: projects.PB, startAt, attendees: [{ userId: people.ben }] })).id;
  const MN_A = (await P.amy.post('/meetings', { title: 'MN_A ZZALPHA meeting', companyId: companies.A, startAt, attendees: [{ userId: people.amy }, { userId: people.ana }] })).id;
  const MN_B = (await P.ben.post('/meetings', { title: 'MN_B ZZBETA meeting', companyId: companies.B, startAt, attendees: [{ userId: people.ben }] })).id;

  // Chats.
  const direct = async (from, to, body, poster = from) => {
    const conv = await P[from].post('/conversations/direct', { userId: people[to] });
    const id = conv.id ?? conv.conversation?.id;
    await P[poster].post(`/conversations/${id}/messages`, { body });
    return id;
  };
  const channel = async (who, p, body) => {
    const { conversation } = await P[who].get(`/projects/${projects[p]}/chat`);
    await P[who].post(`/conversations/${conversation.id}/messages`, { body });
    return conversation.id;
  };
  const chats = {
    anaAmy: await direct('ana', 'amy', 'ZZALPHA direct'),
    anaBen: await direct('ana', 'ben', 'ZZDIRECT hello from before', 'ben'),
    catAna: await direct('cat', 'ana', 'ZZCATANA direct'),
    PA: await channel('ana', 'PA', 'ZZALPHA channel'),
    PB: await channel('ben', 'PB', 'ZZBETA channel'),
    PAB: await channel('ana', 'PAB', 'ZZSHARED channel'),
    PC: await channel('gus', 'PC', 'ZZGAMMA channel'),
  };

  // ben and bob leave Alpha; Gamma is archived (gus keeps it as his only company, which gives no access).
  await A0.put(`/users/${people.ben}`, { companyIds: [companies.B], primaryCompanyId: companies.B });
  await A0.put(`/users/${people.bob}`, { companyIds: [companies.B], primaryCompanyId: companies.B });
  await A0.post(`/companies/${companies.C}/archive`);

  return { base, tag, password: PASSWORD, companies, people, emails, projects, tasks, attachments: { TA1: attachment?.id ?? null }, meetings: { MA, MB, MN_A, MN_B }, notes: { MA: note?.id ?? null }, actionItems: items, chats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedCompanyWorld()
    .then((w) => console.log(JSON.stringify(w)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
