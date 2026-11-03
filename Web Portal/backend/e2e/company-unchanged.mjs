// "A one-company site is unchanged" (MC1 Task 17): the same people ask a 1.20 server and this one,
// on two copies of the same data, the same questions — and must get the same answers, apart from the
// new company fields.
//
//   node e2e/company-unchanged.mjs <baseOld> <baseNew> --users a@x.test,b@x.test [--password Password1!]
//
// Per user and route it compares the JSON with these keys removed: the companies fields (companies,
// mainCompanyId, archived, colleague, hasAccess, readOnly, authors, companyId, view, company,
// primaryCompanyId) and volatile ones (serverTime, lastActiveAt). Prints SAME per route, or DIFF with
// the first difference; exits 1 on any difference.
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const [OLD, NEW] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const USERS = (opt('users', '') ?? '').split(',').map((u) => u.trim()).filter(Boolean);
const PASSWORD = opt('password', 'Password1!');
if (!OLD || !NEW || USERS.length === 0) {
  console.error('usage: node company-unchanged.mjs <baseOld> <baseNew> --users a@x.test,b@x.test');
  process.exit(2);
}

const NEW_KEYS = new Set(['companies', 'mainCompanyId', 'archived', 'colleague', 'hasAccess', 'readOnly', 'authors', 'companyId', 'view', 'company', 'primaryCompanyId']);
const VOLATILE = new Set(['serverTime', 'lastActiveAt', 'generatedAt']);
const strip = (v) =>
  Array.isArray(v)
    ? v.map(strip)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().filter((k) => !NEW_KEYS.has(k) && !VOLATILE.has(k)).map((k) => [k, strip(v[k])]))
      : v;

function firstDiff(a, b, at = '$') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${at}.${k}`);
      if (d) return d;
    }
  }
  return `${at}: ${JSON.stringify(a)?.slice(0, 160)} ≠ ${JSON.stringify(b)?.slice(0, 160)}`;
}

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const today = day(0);
const ROUTES = [
  '/projects',
  '/projects/overview',
  '/tasks/mine',
  `/tasks?boardDate=${today}`,
  `/calendar?from=${day(-30)}&to=${day(30)}`,
  '/meetings',
  '/activity',
  '/notifications',
  '/reports/projects',
  '/reports/status',
  '/management/overview',
  `/timeline?from=${day(-30)}&to=${day(60)}`,
  `/workload?week=${today}`,
  '/users/directory',
];

async function login(base, identifier) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`${base}: login ${identifier} → ${r.status}`);
  return (await r.json()).data.accessToken;
}
async function get(base, token, url) {
  const r = await fetch(`${base}${url}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

/**
 * Notifications made after the copies were restored (each server's own sweeps — reminders, digests)
 * get their own ids, times and order: compare them as a set of what they say.
 */
const asSet = (rows) =>
  Array.isArray(rows)
    ? rows.map(({ id: _i, createdAt: _c, readAt, ...r }) => ({ ...r, read: !!readAt })).map((r) => JSON.stringify(strip(r))).sort()
    : rows;
const normalize = (url, json) => (url === '/notifications' && json && typeof json === 'object' ? { ...json, data: asSet(json.data) } : json);

let diffs = 0;
for (const user of USERS) {
  const [oldTok, newTok] = await Promise.all([login(OLD, user), login(NEW, user)]);
  for (const url of ROUTES) {
    const [a, b] = await Promise.all([get(OLD, oldTok, url), get(NEW, newTok, url)]);
    const d = a.status !== b.status ? `status ${a.status} ≠ ${b.status}` : firstDiff(strip(normalize(url, a.json)), strip(normalize(url, b.json)));
    if (d) diffs++;
    console.log(`${d ? 'DIFF' : 'SAME'} ${user} GET ${url} (${b.status})${d ? ` — ${d}` : ''}`);
  }
}
console.log(diffs ? `\n${diffs} route(s) differ` : '\nevery route SAME');
process.exitCode = diffs ? 1 : 0;
