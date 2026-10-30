import { describe, it, expect } from 'vitest';
import { micoAiApi } from './mico-ai-api';
import { fakeApiClient } from '../testing/fake-api';
import { hasWeb, interfaceFields, readWeb, appSource as src } from '../testing/web-source';

/** MICO AI's requests (Stage 3 Task 11): the website's paths, each for its own person. */
it('asks the server the website’s way', async () => {
  const { client, calls } = fakeApiClient(); const api = micoAiApi(client);
  await api.chats(' pump '); await api.ask('c1', 'Which of my tasks are overdue?'); await api.ask('c1', 'again', 'm0'); await api.confirm('c1', 'm1', { items: [{ id: 'c1', include: true }] });
  expect(calls).toEqual(['GET /mico-ai/chats?q=pump', 'POST /mico-ai/chats/c1/messages {"text":"Which of my tasks are overdue?"}', 'POST /mico-ai/chats/c1/messages {"text":"again","retryOf":"m0"}', 'POST /mico-ai/chats/c1/messages/m1/confirm {"items":[{"id":"c1","include":true}]}']);
  expect(api.tablePath('c1', 'm1', 2, 'xlsx')).toBe('/mico-ai/chats/c1/messages/m1/tables/2.xlsx'); expect(api.reportPath('c1', 'm1')).toBe('/mico-ai/chats/c1/messages/m1/report.pdf');
});

it('every other request, with its ids encoded, unwrapped and sent as the person', async () => {
  const { client, calls, opts } = fakeApiClient((_m, p) => (p === '/mico-ai/status' ? { ready: true, message: null } : undefined));
  const api = micoAiApi(client);
  const o = { asUser: 'u1' };
  expect(await api.status(o)).toEqual({ ready: true, message: null });
  await api.chats(undefined, o); await api.chats('  ', o); await api.create(o); await api.chat('a/b', o); await api.older('c1', 'm 1', o);
  await api.rename('c1', 'Pumps', o); await api.remove('c1', o); await api.message('c1', 'm1', o); await api.stop('c1', 'm1', o); await api.cancel('c1', 'm1', o); await api.undo('c1', 'm1', { ...o, timeoutMs: 120_000 });
  expect(calls).toEqual([
    'GET /mico-ai/status', 'GET /mico-ai/chats', 'GET /mico-ai/chats', 'POST /mico-ai/chats {}', 'GET /mico-ai/chats/a%2Fb', 'GET /mico-ai/chats/c1/messages?before=m%201',
    'PATCH /mico-ai/chats/c1 {"title":"Pumps"}', 'DELETE /mico-ai/chats/c1', 'GET /mico-ai/chats/c1/messages/m1', 'POST /mico-ai/chats/c1/messages/m1/stop', 'POST /mico-ai/chats/c1/messages/m1/cancel', 'POST /mico-ai/chats/c1/messages/m1/undo',
  ]);
  expect(opts.every((x) => x.asUser === 'u1')).toBe(true);
  expect(opts.at(-1)).toEqual({ asUser: 'u1', timeoutMs: 120_000 });
  expect(api.tablePath('c/1', 'm?1', 1, 'pdf')).toBe('/mico-ai/chats/c%2F1/messages/m%3F1/tables/1.pdf');
});

it('the resources carry MICO AI', () => expect(src('lib/resources.ts')).toMatch(/micoAi: micoAiApi\(client\)/));

describe.skipIf(!hasWeb('frontend/src/api/mico-ai.ts'))('the website’s types', () => {
  it('same fields', () => { for (const n of ['MicoAiMessage', 'MicoAiAnswer', 'MicoAiProposal', 'MicoAiTable', 'MicoAiChat', 'CreateTaskFields', 'MeetingFields', 'UpdateTaskChange']) expect(interfaceFields(src('lib/mico-ai-api.ts'), n), n).toEqual(interfaceFields(readWeb('frontend/src/api/mico-ai.ts'), n)); });
  it('every type the website has', () => {
    const web = readWeb('frontend/src/api/mico-ai.ts');
    for (const n of [...web.matchAll(/export (?:interface|type) (\w+)/g)].map((m) => m[1]!)) expect(src('lib/mico-ai-api.ts'), n).toMatch(new RegExp(`export (?:interface|type) ${n}\\b`));
  });
});
