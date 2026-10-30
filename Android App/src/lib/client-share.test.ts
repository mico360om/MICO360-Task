import { describe, it, expect } from 'vitest';
import { apiRoutes, appSource as src, hasWeb, loadWebTs, readWeb } from '../testing/web-source';
import { clientSharesApi, clientSwitchStep } from './client-share';
import { highlightNames } from './name-highlight';
import type { ApiClient } from './api-client';

/** Client sharing's calls, the name highlighter and the preview sheet (Stage 4 Task 2). */
const SAMPLES: Array<[string, string[]]> = [
  ['Sara Ahmed checked it; sara too', ['Sara', 'Sara Ahmed']],
  ['Saraah is not Sara', ['Sara']],
  ['تم الفحص بواسطة أحمد.', ['أحمد']],
  ['Ask OMAR or omar-k', ['Omar']],
  ['No names here', []],
  ['', ['Sara']],
  ['Ann Lee, ann lee and AnnLee; (Ann)', [' Ann Lee ', 'Ann', '']],
  ['12Omar Omar2 Omar', ['Omar']],
];

describe.skipIf(!hasWeb('frontend/src/lib/name-highlight.ts', 'frontend/src/api/client-shares.ts'))('the website’s', () => {
  it('finds the same names as the website’s highlightNames', () => {
    const web = loadWebTs('frontend/src/lib/name-highlight.ts').highlightNames as typeof highlightNames;
    for (const [t, n] of SAMPLES) expect(highlightNames(t, n), t).toEqual(web(t, n));
  });
  it('sharing calls go to the website’s paths', () => {
    const web = apiRoutes(readWeb('frontend/src/api/client-shares.ts'));
    const app = apiRoutes(src('lib/client-share.ts'));
    expect(Object.keys(app).length).toBe(8);
    for (const [k, r] of Object.entries(app)) expect(r, k).toBe(web[k]);
  });
});

it('turning Show to client on opens the preview first; off hides at once (Review Focus 5)', () => {
  expect(clientSwitchStep(false, true)).toBe('preview');
  expect(clientSwitchStep(true, false)).toBe('hide');
  expect(clientSwitchStep(true, true)).toBe('none');
  expect(clientSwitchStep(false, false)).toBe('none');
});

it('minutes are shown with or without their risks, and hidden with the switch alone', async () => {
  const calls: Array<{ path: string; body: unknown; headers?: Record<string, string> }> = [];
  const client = {
    put: async (path: string, body: unknown) => (calls.push({ path, body }), { data: {} }),
    post: async (path: string, body: unknown, opts?: { headers?: Record<string, string> }) => (calls.push({ path, body, headers: opts?.headers }), { data: {} }),
  } as unknown as ApiClient;
  const api = clientSharesApi(client);
  await api.setMinutesVisible('m1', true);
  await api.setMinutesVisible('m1', true, true);
  await api.setMinutesVisible('m1', false, true);
  await api.add('p/1', { name: 'Ann', email: 'a@x.om' }, 'key-1');
  expect(calls).toEqual([
    { path: '/meetings/m1/client-visibility', body: { visible: true, includeRisks: false } },
    { path: '/meetings/m1/client-visibility', body: { visible: true, includeRisks: true } },
    { path: '/meetings/m1/client-visibility', body: { visible: false } },
    { path: '/projects/p%2F1/client-shares', body: { name: 'Ann', email: 'a@x.om' }, headers: { 'Idempotency-Key': 'key-1' } },
  ]);
});

it('the name finder has no Unicode property escapes', () => expect(src('lib/name-highlight.ts')).not.toMatch(/\\p\{/));

it('the preview can only be confirmed once it has loaded', () => {
  const s = src('components/client-share/ClientPreviewSheet.tsx');
  expect(s).toContain("confirmLabel = 'Show to client'");
  expect(s).toMatch(/disabled=\{loading \|\| !!error \|\| busy\}/);
  expect(s).toContain('title="Cancel"');
});

it('names are marked on the warning tint in ink', () => {
  const s = src('components/client-share/MarkedText.tsx');
  expect(s).toMatch(/highlightNames\(text, names\)/);
  expect(s).toMatch(/backgroundColor: c\.warningSoft/);
  expect(s).toMatch(/color: c\.ink/);
});
