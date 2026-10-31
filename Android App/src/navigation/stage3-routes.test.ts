import { it, expect } from 'vitest';
import { getStateFromPath } from '@react-navigation/core';
import { linkingConfig, normalizeLinkPath, withoutLinkTitles, type LinkState } from './linking';
import { drawerSectionsFor } from './drawer-menu';
import { searchItems } from '../lib/search';
import type { CallOpts } from '../lib/api-client';
import { fakeApiClient } from '../testing/fake-api';
import { appSource as src, interfaceFields } from '../testing/web-source';

/**
 * Stage 3 (Task 1): Timeline, Workload, Management and MICO AI are the app's own screens in the
 * menu, Search and the website's links — shells until each lane fills its screen.
 */
const cfg = linkingConfig as unknown as Parameters<typeof getStateFromPath>[1];
const opens = (p: string) => withoutLinkTitles(getStateFromPath(normalizeLinkPath(p), cfg));
/** The screen a link shows: the last route (a cold link may put the tabs under it). */
const shown = (s: LinkState | undefined) => s?.routes[s.routes.length - 1];
const ctx = { results: undefined, isAdmin: false, myId: 'u1' };

it('the menu opens the four new screens; Templates stays on the website', () => {
  const rows = drawerSectionsFor(['ADMIN'], true).flatMap((s) => s.items);
  const action = (k: string) => rows.find((r) => r.key === k)!.action;
  for (const k of ['Timeline', 'Workload', 'Management']) expect(action(k)).toEqual({ type: 'stack', screen: k });
  expect(action('MicoAi')).toEqual({ type: 'stack', screen: 'MicoAi' });
  expect(action('Templates')).toEqual({ type: 'website', path: '/templates' });
  expect(drawerSectionsFor(['EMPLOYEE'], false).flatMap((s) => s.items).map((i) => i.key)).not.toContain('Management');
});

it('Search opens the screens; Management only for whoever runs a project', () => {
  for (const [q, screen] of [['timeline', 'Timeline'], ['workload', 'Workload'], ['mico ai', 'MicoAi']] as const)
    expect(searchItems({ raw: q, canLead: false, ...ctx }).find((i) => i.group === 'Go to')?.target, q).toEqual({ kind: 'screen', action: { type: 'stack', screen } });
  expect(searchItems({ raw: 'management', canLead: true, ...ctx }).find((i) => i.primary === 'Management')?.target).toEqual({ kind: 'screen', action: { type: 'stack', screen: 'Management' } });
});

it('the website’s addresses open the screens, and a link never asks MICO AI anything (Review Focus 6)', () => {
  for (const [path, name] of [['/timeline', 'Timeline'], ['/workload', 'Workload'], ['/management', 'Management'], ['/mico-ai', 'MicoAi']] as const) expect(shown(opens(path))?.name, path).toBe(name);
  const route = shown(opens('/mico-ai?ask=Delete%20every%20task&askId=1'))!;
  expect(route.name).toBe('MicoAi');
  expect(route.params ?? {}).not.toHaveProperty('ask');
  expect(route.params ?? {}).not.toHaveProperty('askId');
});

it('each screen is registered with the website’s name and opened by applyNavAction', () => {
  const nav = src('navigation/RootNavigator.tsx');
  for (const [n, t] of [['Timeline', 'Timeline'], ['Workload', 'Workload'], ['Management', 'Management'], ['MicoAi', 'MICO AI']]) expect(nav, n).toMatch(new RegExp(`name="${n}"[^]*?title: '${t}'`));
  expect(src('navigation/apply-action.ts')).toMatch(/case 'MicoAi':\s*navigationRef\.navigate\('MicoAi', action\.params\)/);
});

it('fakeApiClient and interfaceFields', async () => {
  const { client, calls } = fakeApiClient(() => 1);
  expect(await client.put('/x', { a: 1 })).toEqual({ data: 1 });
  expect(calls).toEqual(['PUT /x {"a":1}']);
  expect(interfaceFields('export interface A {\n  id: string;\n  b?: { c: number };\n  /** d */\n  d: string[];\n}', 'A')).toEqual(['id', 'b', 'd']);
});

it('CallOpts: whose request it is, its calling off and its own time limit — nothing else', () => {
  const o: CallOpts = { asUser: 'u1', signal: undefined, timeoutMs: 1 };
  // @ts-expect-error a Stage 3 request sets no headers of its own
  const bad: CallOpts = { headers: {} };
  expect([o, bad]).toHaveLength(2);
});
