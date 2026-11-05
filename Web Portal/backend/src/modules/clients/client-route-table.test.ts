import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { CLIENT_ROUTE_CLASSES, clientMayCall, clientRouteClass, routeKeyOf, staffMayCall } from './client-route-table';
import { ROUTE_CLASSES } from '../companies/route-classes';

// Client accounts (1.23): every route the server registers has one client class — deny by default.
// The source is scanned like the companies table (route-classes.test.ts), so a portal route can't be
// added without its row, and nothing a client may call can appear without being reviewed here.
const SRC = resolve(__dirname, '..', '..');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}
const FILES = [...sourceFiles(join(SRC, 'modules')), join(SRC, 'app.ts'), join(SRC, 'server.ts'), join(SRC, 'lib', 'web-app.ts')];
const ROUTE = /\b(?:app|api)\.(get|post|put|patch|delete)\(\s*(['`])([^'`]+)\2/g;
const found = FILES.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(ROUTE)].map((m) => ({ key: `${m[1]!.toUpperCase()} ${m[3]}`, file: relative(SRC, file).split(sep).join('/') })),
);
const scanned = found.map((r) => r.key);

/** Every route a client account may call besides the portal itself, reviewed one by one. */
const REVIEWED_BOTH = [
  'POST /users/me/password',
  // 1.23 integration: the Error log's reports come from every page's browser — a client's portal pages too.
  'POST /client-errors',
  'POST /client-errors/csp',
];

describe('Client route table (deny by default)', () => {
  it('the scan finds the routes', () => {
    expect(scanned.length).toBeGreaterThan(250);
    expect(scanned).toContain('GET /portal/me');
  });

  it('every route the server registers has a client class', () => {
    const unclassified = found.filter((r) => clientRouteClass(r.key) === undefined).map((r) => `${r.key}  (${r.file})`);
    expect(unclassified).toEqual([]);
  });

  it('every row of the table names a route that exists', () => {
    expect(Object.keys(CLIENT_ROUTE_CLASSES).filter((k) => !scanned.includes(k))).toEqual([]);
  });

  it('every portal route is in the table as a client route, and only portal routes are', () => {
    const portal = scanned.filter((k) => k.split(' ')[1]!.startsWith('/portal'));
    expect(portal.length).toBeGreaterThan(5);
    expect(portal.filter((k) => CLIENT_ROUTE_CLASSES[k] !== 'client')).toEqual([]);
    expect(Object.entries(CLIENT_ROUTE_CLASSES).filter(([k, c]) => c === 'client' && !k.split(' ')[1]!.startsWith('/portal')).map(([k]) => k)).toEqual([]);
  });

  it('a client may call only the reviewed routes outside the portal', () => {
    const both = Object.entries(CLIENT_ROUTE_CLASSES).filter(([, c]) => c === 'both').map(([k]) => k).sort();
    expect(both).toEqual([...REVIEWED_BOTH].sort());
  });

  it('public routes are the companies table’s public routes; everything else defaults to staff', () => {
    for (const key of scanned) {
      const cls = clientRouteClass(key);
      if (key in CLIENT_ROUTE_CLASSES) continue;
      expect(cls).toBe(ROUTE_CLASSES[key] === 'public' ? 'public' : 'staff');
    }
    expect(clientRouteClass('GET /projects')).toBe('staff');
    expect(clientRouteClass('GET /users/directory')).toBe('staff');
    expect(clientRouteClass('GET /tasks/:id/comments')).toBe('staff');
    expect(clientRouteClass('POST /auth/login')).toBe('public');
    expect(clientRouteClass('GET /client/view')).toBe('public');
  });

  it('an unknown route has no class, and a client may not call it', () => {
    expect(clientRouteClass('GET /made-up/:id')).toBeUndefined();
    expect(clientMayCall('GET /made-up/:id')).toBe(false);
    expect(clientMayCall('GET /reports/status.csv')).toBe(false);
    expect(clientMayCall('GET /projects')).toBe(false);
    expect(clientMayCall('POST /auth/login')).toBe(false); // public routes don't ask who is signed in
    expect(clientMayCall('GET /portal/me')).toBe(true);
    expect(clientMayCall('POST /users/me/password')).toBe(true);
  });

  it('staff may call everything but the portal', () => {
    expect(staffMayCall('GET /portal/me')).toBe(false);
    expect(staffMayCall('GET /projects')).toBe(true);
    expect(staffMayCall('POST /users/me/password')).toBe(true);
    expect(staffMayCall('GET /made-up/:id')).toBe(true);
  });

  it('turns a registered route into its table key (the API prefix off)', () => {
    expect(routeKeyOf('GET', '/api/v1/portal/me')).toBe('GET /portal/me');
    expect(routeKeyOf('post', '/api/v1/users/me/password')).toBe('POST /users/me/password');
    expect(routeKeyOf('GET', '/')).toBe('GET /');
    expect(routeKeyOf('HEAD', '/api/v1/portal/me')).toBe('GET /portal/me');
  });
});

describe('1.23 integration: the other lanes’ routes and client accounts', () => {
  it('a client’s browser may report to the Error log, but never read it', () => {
    expect(clientMayCall('POST /client-errors')).toBe(true);
    expect(clientMayCall('POST /client-errors/csp')).toBe(true);
    for (const k of ['GET /error-log', 'GET /error-log/:id', 'POST /error-log/:id/fixed', 'DELETE /error-log/:id/fixed', 'POST /error-log/visit']) {
      expect(clientRouteClass(k), k).toBe('staff');
    }
    // Staff report too (the sign-in page and every staff page).
    expect(staffMayCall('POST /client-errors')).toBe(true);
  });

  it('search, meeting series, Teams and the Table view’s action-item edits are staff routes', () => {
    const staffOnly = scanned.filter((k) => /^\w+ \/(search|meeting-series|integrations\/microsoft)/.test(k) || /\/meetings\/:id\/(series|series-options|teams-link)$/.test(k) || k === 'PATCH /action-items/:id');
    expect(staffOnly.length).toBeGreaterThan(14);
    for (const k of staffOnly) expect(clientMayCall(k), k).toBe(false);
    // Compact rows (1.23.0): a person's row spacing is saved on /users/me/preferences — staff only; the
    // Client portal never offers it (website test: compact-variant.test.ts).
    expect(clientMayCall('GET /users/me/preferences')).toBe(false);
    expect(clientMayCall('PUT /users/me/preferences')).toBe(false);
    // Microsoft's way back carries no session (the signed state and the browser's flow cookie decide).
    expect(clientRouteClass('GET /integrations/microsoft/callback')).toBe('public');
  });
});

