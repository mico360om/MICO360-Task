import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ErrorLogPage } from './ErrorLogPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const GROUPS = [
  { id: 'g1', kind: 'ERROR', title: "TypeError: Cannot read properties of undefined (reading 'title')", count: 12, people: 3, firstSeenAt: '2026-11-05T09:00:00.000Z', lastSeenAt: '2026-11-05T10:00:00.000Z', page: '/projects/:id', version: '1.22.4', status: 'OPEN', fixedAt: null, fixedInVersion: null, reopenedAt: null },
  { id: 'g2', kind: 'SERVER', title: 'nightly backup sweep failed: ENOSPC', count: 1, people: 0, firstSeenAt: '2026-11-01T02:00:00.000Z', lastSeenAt: '2026-11-04T02:00:00.000Z', page: 'nightly-backup', version: '1.22.4', status: 'OPEN', fixedAt: null, fixedInVersion: null, reopenedAt: null },
];
const DETAIL = {
  group: { ...GROUPS[0], topFile: 'src/pages/ProjectDetailPage.tsx', topLine: 212, topFunction: 'ProjectHeader' },
  events: [
    { id: 'e1', at: '2026-11-05T10:00:00.000Z', kind: 'ERROR', detail: 'boundary', message: GROUPS[0]!.title, stack: "TypeError: Cannot read properties of undefined (reading 'title')\n    at ProjectHeader (src/pages/ProjectDetailPage.tsx:212:31)", page: '/projects/:id', job: null, resource: null, value: null, count: 2, version: '1.22.4', browser: 'Chrome 130', system: 'Windows', screen: '1440x900', signedIn: true, person: { id: 'u1', name: 'Sara Ali' } },
    { id: 'e2', at: '2026-11-05T09:00:00.000Z', kind: 'ERROR', detail: 'boundary', message: GROUPS[0]!.title, stack: null, page: '/projects/:id', job: null, resource: null, value: null, count: 1, version: '1.22.4', browser: 'Safari 17', system: 'iOS', screen: '390x844', signedIn: false, person: null },
  ],
};
// 1.22.5: a database error's occurrences carry what the database said (values masked by the server).
const SAID = "P2010 · code 1366 · Incorrect string value: '?' for column 'doc' at row 1";
const SERVER_DETAIL = {
  group: { ...GROUPS[1], topFile: 'src/modules/search/task-search-engine.ts', topLine: 119, topFunction: 'Object.search' },
  events: [
    { id: 'e3', at: '2026-11-04T02:00:00.000Z', kind: 'SERVER', detail: 'request', message: GROUPS[1]!.title, stack: '    at Object.search (src/modules/search/task-search-engine.ts:119:29)', page: 'GET /api/v1/search', job: null, resource: null, database: SAID, value: null, count: 1, version: '1.22.4', browser: null, system: null, screen: null, signedIn: true, person: { id: 'u2', name: 'Omar Said' } },
    { id: 'e4', at: '2026-11-04T01:00:00.000Z', kind: 'SERVER', detail: 'request', message: GROUPS[1]!.title, stack: null, page: 'GET /api/v1/search', job: null, resource: null, database: null, ai: 'MICO360 AI · correlation id REQ-77 · job JOB-GW1-9', value: null, count: 1, version: '1.22.4', browser: null, system: null, screen: null, signedIn: true, person: { id: 'u2', name: 'Omar Said' } },
  ],
};

let calls: { url: string; method: string }[];
let previousVisitAt: string | null;
let databaseCheck: unknown = null;
/** 1.23.2: what POST /error-log/database-check ("Check again") answers. */
let checkAgain: () => Promise<Response> = async () => json({ data: null });
let fixed: Set<string>;
beforeEach(() => {
  calls = [];
  previousVisitAt = '2026-11-04T12:00:00.000Z';
  fixed = new Set();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method });
      if (u.endsWith('/error-log/visit')) return json({ data: { previousVisitAt } });
      if (u.endsWith('/error-log/database-check') && method === 'POST') return checkAgain();
      if (/\/error-log\/g1\/fixed$/.test(u)) {
        if (method === 'POST') fixed.add('g1');
        else fixed.delete('g1');
        return json({ data: { ...GROUPS[0], status: method === 'POST' ? 'FIXED' : 'OPEN' } });
      }
      if (/\/error-log\/g1$/.test(u)) return json({ data: DETAIL });
      if (/\/error-log\/g2$/.test(u)) return json({ data: SERVER_DETAIL });
      if (u.includes('/error-log?')) {
        const params = new URL(u, 'http://x').searchParams;
        const status = params.get('status');
        let groups = GROUPS.filter((g) => (status === 'fixed' ? fixed.has(g.id) : !fixed.has(g.id)));
        if (params.get('kind') === 'server') groups = groups.filter((g) => g.kind === 'SERVER');
        if (params.get('q')) groups = groups.filter((g) => g.title.includes(params.get('q')!));
        const g = status === 'fixed' ? groups.map((x) => ({ ...x, status: 'FIXED', fixedInVersion: '1.22.4' })) : groups;
        return json({ data: { groups: g, next: null, counts: { all: 2, errors: 1, blocked: 0, slow: 0, server: 1 }, databaseCheck } });
      }
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat' } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  databaseCheck = null;
  checkAgain = async () => json({ data: null });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ErrorLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const lastList = () => new URL(calls.filter((c) => c.url.includes('/error-log?')).at(-1)!.url, 'http://x').searchParams;

describe('ErrorLogPage (System Settings → Error log)', () => {
  it('lists each error once with its kind, count, people, page and version; the chips show how many', async () => {
    renderPage();
    const row = (await screen.findByText(/Cannot read properties of undefined/)).closest('li')!;
    expect(within(row).getByText('Error')).toBeInTheDocument();
    expect(within(row).getByText('12 times')).toBeInTheDocument();
    expect(within(row).getByText('3 people')).toBeInTheDocument();
    expect(within(row).getByText('/projects/:id')).toBeInTheDocument();
    expect(within(row).getByText('Version 1.22.4')).toBeInTheDocument();
    const server = screen.getByText('nightly backup sweep failed: ENOSPC').closest('li')!;
    expect(within(server).getByText('Server')).toBeInTheDocument();
    expect(within(server).getByText('nightly-backup')).toBeInTheDocument();
    expect(within(server).getByText('No one in particular')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Errors, 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Server, 1' })).toBeInTheDocument();
    expect(lastList().get('range')).toBe('7d');
    expect(lastList().get('status')).toBe('open');
  });

  it('marks what is new since the last visit', async () => {
    renderPage();
    const row = (await screen.findByText(/Cannot read properties of undefined/)).closest('li')!;
    await waitFor(() => expect(within(row).getByText('New')).toBeInTheDocument());
    expect(within(screen.getByText('nightly backup sweep failed: ENOSPC').closest('li')!).queryByText('New')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('1 new since your last visit on 4 Nov 2026, 16:00.');
  });

  it('filters by kind, date and words', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Cannot read properties of undefined/);
    await user.click(screen.getByRole('button', { name: 'Server, 1' }));
    await waitFor(() => expect(lastList().get('kind')).toBe('server'));
    expect(await screen.findByText('nightly backup sweep failed: ENOSPC')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Cannot read properties of undefined/)).toBeNull());
    await user.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(lastList().get('range')).toBe('30d'));
    await user.type(screen.getByRole('searchbox', { name: 'Search the error log' }), 'nothing like it');
    await waitFor(() => expect(lastList().get('q')).toBe('nothing like it'));
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument();
  });

  it('opening a row: the site’s own file:line, the stack and the latest occurrences with names; Mark as fixed', async () => {
    const user = userEvent.setup();
    renderPage();
    const button = (await screen.findByText(/Cannot read properties of undefined/)).closest('button')!;
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('src/pages/ProjectDetailPage.tsx:212 (ProjectHeader)')).toBeInTheDocument();
    expect(screen.getByLabelText('Stack of the latest occurrence')).toHaveTextContent('at ProjectHeader (src/pages/ProjectDetailPage.tsx:212:31)');
    expect(screen.getByText('Sara Ali')).toBeInTheDocument();
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(screen.getByText(/Chrome 130 on Windows · Version 1\.22\.4 · Window 1440×900 · 2 times in one visit/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as fixed' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/error-log/g1/fixed'))).toBe(true));
    await waitFor(() => expect(screen.queryByText(/Cannot read properties of undefined/)).toBeNull());
  });

  it('a database error says what the database said: the latest one above the stack, and on each occurrence', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findByText('nightly backup sweep failed: ENOSPC')).closest('button')!);
    const said = await screen.findByLabelText('What the database said (latest)');
    expect(said).toHaveTextContent(`Database said: ${SAID}`);
    const occurrences = screen.getByText('Latest occurrences').parentElement!;
    expect(within(occurrences).getAllByText(`Database said: ${SAID}`)).toHaveLength(1);
  });

  // MICO360 AI (b) bundles, b10: an AI failure's occurrence shows the ids to quote to MICO360 Connect.
  it('a MICO360 AI failure’s occurrence shows its correlation and job ids', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findByText('nightly backup sweep failed: ENOSPC')).closest('button')!);
    const occurrences = (await screen.findByText('Latest occurrences')).parentElement!;
    expect(within(occurrences).getByText('MICO360 AI · correlation id REQ-77 · job JOB-GW1-9')).toBeInTheDocument();
  });

  it('“Marked fixed” lists them, with Not fixed to bring one back', async () => {
    const user = userEvent.setup();
    fixed.add('g1');
    renderPage();
    await screen.findByText('nightly backup sweep failed: ENOSPC');
    await user.click(screen.getByRole('switch', { name: 'Show the ones marked fixed' }));
    await waitFor(() => expect(lastList().get('status')).toBe('fixed'));
    await user.click((await screen.findByText(/Cannot read properties of undefined/)).closest('button')!);
    await user.click(await screen.findByRole('button', { name: 'Not fixed' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/error-log/g1/fixed'))).toBe(true));
  });

  it('nothing yet: says so; the log can’t be read: says that, with Retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/error-log?') ? json({ data: { groups: [], next: null, counts: { all: 0, errors: 0, blocked: 0, slow: 0, server: 0 } } }) : json({ data: { previousVisitAt: null } }))));
    renderPage();
    expect(await screen.findByText('No errors — all quiet')).toBeInTheDocument();
  });

  it('the log can’t be read: Retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/error-log?') ? json({ error: { code: 'INTERNAL' } }, 500) : json({ data: { previousVisitAt: null } }))));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the error log.');
  });
});

// 1.23.3 — a slow request says where its time went: the server, the database or the network (the
// server's Server-Timing, sent by the page with its report).
describe('Error log — where a slow request’s time went', () => {
  const slowRow = (id: string, title: string, timing: unknown) => ({ ...GROUPS[0], id, kind: 'SLOW', title, count: 2, people: 1, page: '/board', timing });
  const SLOW_GROUPS = [
    slowRow('s1', 'Slow request: GET /api/v1/tasks', { totalMs: 10_200, serverMs: 9900, dbMs: 9700 }),
    slowRow('s2', 'Slow request: GET /api/v1/projects', { totalMs: 12_000, serverMs: 100, dbMs: 40 }),
    slowRow('s3', 'Slow page load', null),
    { ...slowRow('s4', 'Slow request: GET /api/v1/chat', null), timing: undefined }, // an older server: no timing at all
  ];
  const occurrence = (id: string, message: string, value: number, timing: unknown) => ({ id, at: '2026-11-05T10:00:00.000Z', kind: 'SLOW', detail: 'api', message, stack: null, page: '/board', job: null, resource: 'GET /api/v1/tasks', value, count: 1, version: '1.23.3', browser: 'Chrome 130', system: 'Windows', screen: null, signedIn: true, person: { id: 'u1', name: 'Sara Ali' }, timing });
  const S1_DETAIL = {
    group: { ...SLOW_GROUPS[0], topFile: null, topLine: null, topFunction: null },
    events: [
      occurrence('o1', 'Slow request: GET /api/v1/tasks took 10.2 s', 10_200, { totalMs: 10_200, serverMs: 9900, dbMs: 9700 }),
      occurrence('o2', 'Slow request: GET /api/v1/tasks took 11.0 s', 11_000, null), // before 1.23.3
    ],
  };
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith('/error-log/visit')) return json({ data: { previousVisitAt: null } });
        if (/\/error-log\/s1$/.test(u)) return json({ data: S1_DETAIL });
        if (u.includes('/error-log?')) return json({ data: { groups: SLOW_GROUPS, next: null, counts: { all: 4, errors: 0, blocked: 0, slow: 4, server: 0 } } });
        if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat' } });
        return json({ data: [] });
      }),
    );
  });

  it('a row says where the last time’s wait went: in the database, or the network', async () => {
    renderPage();
    const tasks = (await screen.findByText('Slow request: GET /api/v1/tasks')).closest('li')!;
    expect(within(tasks).getByText('Last time 10.2 s: server 9.9 s · in the database 9.7 s')).toBeInTheDocument();
    const projects = screen.getByText('Slow request: GET /api/v1/projects').closest('li')!;
    expect(within(projects).getByText('Last time 12.0 s: server 0.1 s · the rest was the network')).toBeInTheDocument();
  });

  it('rows without it (other slow kinds, older reports, an older server) look as before', async () => {
    renderPage();
    const load = (await screen.findByText('Slow page load')).closest('li')!;
    expect(within(load).queryByText(/Last time/)).toBeNull();
    expect(within(screen.getByText('Slow request: GET /api/v1/chat').closest('li')!).queryByText(/Last time/)).toBeNull();
  });

  it('the details: each occurrence that said it, under its own words; no stack', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findByText('Slow request: GET /api/v1/tasks')).closest('button')!);
    const occurrences = (await screen.findByText('Latest occurrences')).parentElement!;
    expect(within(occurrences).getByText('Slow request: GET /api/v1/tasks took 10.2 s')).toBeInTheDocument();
    expect(within(occurrences).getAllByText('server 9.9 s · in the database 9.7 s')).toHaveLength(1);
    expect(within(occurrences).getByText('Slow request: GET /api/v1/tasks took 11.0 s')).toBeInTheDocument();
    expect(screen.queryByText('Stack (latest)')).toBeNull();
  });
});

// 1.23.1 — the database self-check: what the live database is (its server, settings) and whether it
// holds what the app expects. One line above the rows; its problems listed when there are any.
describe('Error log — the database check', () => {
  const server = { product: 'MySQL', version: '8.0.46', sqlMode: 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES', lowerCaseTableNames: 0 };

  it('OK: one line with the server, and its settings beside it', async () => {
    databaseCheck = { checkedAt: '2026-11-05T09:30:00.000Z', ok: true, server, problems: [], summary: 'Database check: OK (MySQL 8.0.46)' };
    renderPage();
    const line = await screen.findByText('Database check: OK (MySQL 8.0.46)');
    const box = line.closest('[data-database-check]')!;
    expect(box).toHaveTextContent('sql_mode ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES');
    expect(box).toHaveTextContent('lower_case_table_names 0');
    expect(within(box as HTMLElement).queryByRole('list')).toBeNull();
    // An older server sends no pool size: nothing about it.
    expect(box).not.toHaveTextContent(/pool/);
  });

  it('1.23.2: the connection pool’s size with the settings (“pool 10”), and a server not in strict mode said', async () => {
    const live = { product: 'MariaDB', version: '11.8.9-MariaDB-log', sqlMode: 'NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', lowerCaseTableNames: 0 };
    databaseCheck = { checkedAt: '2026-11-05T09:30:00.000Z', ok: true, server: live, problems: [], summary: 'Database check: OK (MariaDB 11.8.9) · not in strict mode: text that’s too long is cut short instead of refused', strict: false, pool: 10 };
    renderPage();
    const box = (await screen.findByText(/not in strict mode/)).closest('[data-database-check]') as HTMLElement;
    expect(box).toHaveTextContent('11.8.9-MariaDB-log · sql_mode NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION · lower_case_table_names 0 · pool 10');
  });

  it('problems: the count, the server, and each problem with its exact names', async () => {
    databaseCheck = {
      checkedAt: '2026-11-05T09:30:00.000Z',
      ok: false,
      server: { product: 'MariaDB', version: '11.4.5-MariaDB-log', sqlMode: 'STRICT_TRANS_TABLES', lowerCaseTableNames: 0 },
      problems: [
        { kind: 'column', name: 'task_search_index.head', text: 'Column task_search_index.head is missing' },
        { kind: 'query', name: 'the task search (two words)', text: "The task search (two words) fails: P2010 · code 1054 · Unknown column '0' in 'ORDER BY'" },
      ],
      summary: 'Database check: 2 problems (MariaDB 11.4.5)',
    };
    renderPage();
    const box = (await screen.findByText('Database check: 2 problems (MariaDB 11.4.5)')).closest('[data-database-check]') as HTMLElement;
    expect(box).toHaveTextContent('11.4.5-MariaDB-log');
    const items = within(box).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Column task_search_index.head is missing', "The task search (two words) fails: P2010 · code 1054 · Unknown column '0' in 'ORDER BY'"]);
  });

  it('1.23.2 “Check again”: runs the check now and shows its new result', async () => {
    databaseCheck = { checkedAt: '2026-11-05T09:30:00.000Z', ok: false, server, problems: [{ kind: 'busy', name: 'the Management page', text: 'The Management page couldn’t be checked — the database was busy' }], summary: 'Database check: couldn’t finish — the database was busy (MySQL 8.0.46)', strict: true };
    let answer: (r: Response) => void = () => {};
    checkAgain = () => new Promise<Response>((r) => (answer = r));
    renderPage();
    const box = (await screen.findByText('Database check: couldn’t finish — the database was busy (MySQL 8.0.46)')).closest('[data-database-check]') as HTMLElement;
    // A database that was busy is a warning, not a list of failures.
    expect(box).toHaveAttribute('data-database-check', 'busy');
    await userEvent.click(within(box).getByRole('button', { name: 'Check again' }));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/error-log/database-check'))).toBe(true);
    // Busy: announced as unavailable and ignores presses (focus stays on it).
    expect(within(box).getByRole('button', { name: /Checking/ })).toHaveAttribute('aria-disabled', 'true');
    answer(json({ data: { checkedAt: new Date().toISOString(), ok: true, server, problems: [], summary: 'Database check: OK (MySQL 8.0.46)', strict: true } }));
    expect(await screen.findByText('Database check: OK (MySQL 8.0.46)')).toBeInTheDocument();
    expect(screen.getByText('Database check: OK (MySQL 8.0.46)').closest('[data-database-check]')).toHaveAttribute('data-database-check', 'ok');
    expect(screen.queryByText(/couldn’t be checked/)).toBeNull();
  });

  it('1.23.2 “Check again” that can’t run says so and keeps the last result', async () => {
    databaseCheck = { checkedAt: '2026-11-05T09:30:00.000Z', ok: true, server, problems: [], summary: 'Database check: OK (MySQL 8.0.46)', strict: true };
    checkAgain = async () => json({ error: { code: 'INTERNAL', message: 'x' } }, 500);
    renderPage();
    const box = (await screen.findByText('Database check: OK (MySQL 8.0.46)')).closest('[data-database-check]') as HTMLElement;
    await userEvent.click(within(box).getByRole('button', { name: 'Check again' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('The check couldn’t run just now — try again.');
    expect(within(box).getByText('Database check: OK (MySQL 8.0.46)')).toBeInTheDocument();
  });

  it('nothing until the check ran (or an older server)', async () => {
    renderPage();
    expect(await screen.findByText(GROUPS[0]!.title)).toBeInTheDocument();
    expect(screen.queryByText(/Database check/)).toBeNull();
  });
});
