import { describe, it, expect } from 'vitest';
import { parseHash, matchRoute, href, refreshOnReturn } from './router.js';

const ROUTES = [
  { name: 'dashboard', pattern: '/' },
  { name: 'projects', pattern: '/projects' },
  { name: 'board', pattern: '/board/:projectId' },
  { name: 'task', pattern: '/task/:taskId' },
];

describe('parseHash', () => {
  it('defaults empty/hash-only to the root path', () => {
    expect(parseHash('')).toEqual({ path: '/', query: {} });
    expect(parseHash('#')).toEqual({ path: '/', query: {} });
    expect(parseHash('#/')).toEqual({ path: '/', query: {} });
  });
  it('splits the path and query', () => {
    expect(parseHash('#/board/p1?tab=team&x=1')).toEqual({ path: '/board/p1', query: { tab: 'team', x: '1' } });
  });
  it('decodes encoded query values', () => {
    expect(parseHash('#/x?q=a%20b')).toEqual({ path: '/x', query: { q: 'a b' } });
  });
});

describe('matchRoute', () => {
  it('matches a static route', () => {
    expect(matchRoute(ROUTES, '/projects')?.route.name).toBe('projects');
  });
  it('matches a param route and extracts params', () => {
    const m = matchRoute(ROUTES, '/board/p1');
    expect(m?.route.name).toBe('board');
    expect(m?.params).toEqual({ projectId: 'p1' });
  });
  it('matches the root', () => {
    expect(matchRoute(ROUTES, '/')?.route.name).toBe('dashboard');
  });
  it('returns null for an unknown path', () => {
    expect(matchRoute(ROUTES, '/nope/extra/deep')).toBeNull();
  });
});

describe('href', () => {
  it('builds a hash href with a query, dropping empty values', () => {
    expect(href('/board/p1', { tab: 'team', empty: '' })).toBe('#/board/p1?tab=team');
    expect(href('/projects')).toBe('#/projects');
  });
});

describe('refreshOnReturn', () => {
  it('reloads the task screens when the tab is shown again, so copies made elsewhere appear', () => {
    for (const r of [{ name: 'board' }, { name: 'dashboard' }, { name: 'calendar' }]) expect(refreshOnReturn(r, false)).toBe(true);
  });

  it('leaves screens with typing in progress alone, and never reloads under an open task drawer', () => {
    for (const r of [{ name: 'my-tasks' }, { name: 'chat' }, { name: 'chat-thread' }, { name: 'settings' }]) expect(refreshOnReturn(r, false)).toBe(false);
    expect(refreshOnReturn({ name: 'board' }, true)).toBe(false);
    expect(refreshOnReturn(null, false)).toBe(false);
  });
});
