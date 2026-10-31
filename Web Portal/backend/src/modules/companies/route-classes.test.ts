import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { ROUTE_CLASSES } from './route-classes';

// Every route the server registers says how companies scope it (see route-classes.ts). The source is
// scanned, so a new route without a class — or a class for a route that is gone — fails here.
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
const found: { key: string; file: string }[] = FILES.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(ROUTE)].map((m) => ({ key: `${m[1]!.toUpperCase()} ${m[3]}`, file: relative(SRC, file).split(sep).join('/') })),
);
const scanned = found.map((r) => r.key);

describe('Every route has one company class', () => {
  it('finds the routes (the scan itself works)', () => {
    expect(scanned.length).toBeGreaterThan(250);
    expect(scanned).toContain('GET /projects');
    expect(scanned).toContain('GET /api/v1/health');
    expect(scanned).toContain('GET /');
  });

  it('every route the server registers has exactly one company class', () => {
    expect(found.filter((r) => !(r.key in ROUTE_CLASSES)).map((r) => `${r.key}  (${r.file})`)).toEqual([]);
  });

  it('the table names no route that no longer exists', () => {
    expect(Object.keys(ROUTE_CLASSES).filter((k) => !scanned.includes(k))).toEqual([]);
  });

  it('no route is registered twice under one key', () => {
    expect(scanned.filter((k, i) => scanned.indexOf(k) !== i)).toEqual([]);
  });

  it('spot checks against the Route classes table', () => {
    expect(ROUTE_CLASSES['GET /projects']).toBe('list');
    expect(ROUTE_CLASSES['GET /projects/:id']).toBe('object');
    expect(ROUTE_CLASSES['GET /projects/:id/members']).toBe('people');
    expect(ROUTE_CLASSES['GET /tasks/:id/mentionable']).toBe('people');
    expect(ROUTE_CLASSES['GET /users/directory']).toBe('people');
    expect(ROUTE_CLASSES['GET /users']).toBe('admin');
    expect(ROUTE_CLASSES['GET /users/me/export']).toBe('own');
    expect(ROUTE_CLASSES['GET /templates/projects']).toBe('shared');
    expect(ROUTE_CLASSES['GET /client/view']).toBe('public');
    expect(ROUTE_CLASSES['POST /mico-ai/chats/:chatId/messages']).toBe('list');
    expect(ROUTE_CLASSES['GET /mico-ai/chats']).toBe('own');
    expect(ROUTE_CLASSES['GET /reports/${def.key}.xlsx']).toBe('list');
  });
});
