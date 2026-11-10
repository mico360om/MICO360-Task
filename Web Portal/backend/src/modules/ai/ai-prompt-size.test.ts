import { describe, it, expect } from 'vitest';
import { createAiFeatureService } from './ai-feature-service';
import { createMemoryAiConfigRepository } from './ai-config-repository';
import { CONVERSATION_LIMIT } from './ai-completion';
import type { AiConfig } from './ai-config';
import { minutesFacts } from '../meetings/final-minutes';
import { createAiSearch } from '../search/search-ai';
import type { SearchHit } from '../search/search-types';
import { createMicoAiTools } from '../mico-ai/mico-ai-tools';
import { PROMPT_BUDGET, systemPrompt } from '../mico-ai/mico-ai-loop';

/**
 * MICO360 AI's guide (§5, §8, §11): a conversation — system messages included — is limited to 32,000
 * characters; over it, 413. Every AI feature, fed the largest inputs its routes and records allow, must
 * fit, with room left for the platform's own framing ("User: …").
 */
const FITS = CONVERSATION_LIMIT - 500;

const mico: AiConfig = {
  providers: [{ id: 'pr1', name: 'MICO360 AI', kind: 'custom', preset: 'mico360', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_x', enabled: true, createdAt: '', updatedAt: '' }],
  models: [{ id: 'm1', providerId: 'pr1', modelKey: 'llama3.1:latest', displayName: 'Llama 3.1', capabilities: ['chat'], parameters: {}, concurrencyLimit: 64, enabled: true, available: true, createdAt: '', updatedAt: '' }],
  defaults: { chat: 'm1' },
};

const s = (n: number, ch = 'x') => ch.repeat(n);
const id = (i: number) => `c${String(i).padStart(24, '0')}`; // a cuid's length
/** The biggest records the site allows: names 191 (NAME_MAX), project codes 10, numbers 40, names 191. */
const projects = Array.from({ length: 150 }, (_, i) => ({ id: id(i), code: `P${String(i).padStart(9, '0')}`, number: s(40, 'N'), name: s(191, 'P'), status: 'ACTIVE' }));
const people = Array.from({ length: 400 }, (_, i) => ({ id: id(i), firstName: s(191, 'F'), lastName: s(191, 'L'), username: s(191, 'u') }));

/** Each conversation sent (system + user message), in characters. */
function measured() {
  const sizes: number[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { messages: Array<{ content: string }> };
    sizes.push(body.messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"steps":["a"],"title":"t","items":[{"title":"a","minutes":5}],"description":"d","summary":"s","priority":"LOW","reason":"r"}' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const svc = createAiFeatureService({
    repo: createMemoryAiConfigRepository(mico),
    fetchImpl,
    listProjectsFor: async () => projects,
    listPeople: async () => people,
    limits: { perMinute: 1000, perDay: 1000 },
  });
  return { sizes, svc };
}
const me = { userId: 'u1', roles: ['ADMIN'] };

describe('every AI conversation fits MICO360 AI’s 32,000 characters, at the largest inputs', () => {
  it('describe a task (1,000 characters, 100+ projects with the longest names)', async () => {
    const { sizes, svc } = measured();
    await svc.parseTask({ text: s(1000), today: '2026-11-11' }, me);
    expect(sizes[0]).toBeLessThanOrEqual(FITS);
  });

  it('describe a meeting (1,000 characters, 300+ people and 100+ projects with the longest names)', async () => {
    const { sizes, svc } = measured();
    await svc.parseMeeting({ text: s(1000), today: '2026-11-11' }, me);
    expect(sizes[0]).toBeLessThanOrEqual(FITS);
  });

  it('a typical company’s 300 people and 100 projects are still all listed (the budget bites only at extremes)', async () => {
    const prompts: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      prompts.push((JSON.parse(String(init!.body)) as { messages: Array<{ content: string }> }).messages[0]!.content);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"t"}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const svc = createAiFeatureService({
      repo: createMemoryAiConfigRepository(mico),
      fetchImpl,
      listProjectsFor: async () => projects.slice(0, 100).map((p, i) => ({ ...p, number: `PDO-2026-${i}`, name: `Pump station upgrade phase ${i}` })),
      listPeople: async () => people.slice(0, 300).map((p, i) => ({ ...p, firstName: `Person${i}`, lastName: 'Al Balushi', username: `person.${i}` })),
    });
    await svc.parseMeeting({ text: 'meet tomorrow', today: '2026-11-11' }, me);
    expect(prompts[0]!.split('\n').filter((l) => /^c\d{24} \| /.test(l))).toHaveLength(300);
    expect(prompts[0]!.split('\n').filter((l) => /^P\d{9} \| /.test(l))).toHaveLength(100);
  });

  it('draft an agenda (100 people, 30 open tasks, 30 leftovers, the longest texts)', async () => {
    const { sizes, svc } = measured();
    await svc.draftAgenda(
      {
        title: s(300),
        description: s(4000),
        text: s(1000),
        minutes: 720,
        people: people.slice(0, 100).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` })),
        tasks: Array.from({ length: 30 }, (_, i) => ({ key: `P${String(i).padStart(9, '0')}-99999`, title: s(300), reason: 'overdue' as const })),
        leftovers: Array.from({ length: 30 }, () => ({ title: s(300), kind: 'action' as const })),
      },
      me,
    );
    expect(sizes[0]).toBeLessThanOrEqual(FITS);
  });

  it('the checklist, priority, project summary and meeting description', async () => {
    const { sizes, svc } = measured();
    await svc.breakdownTask({ title: s(300), description: s(4000) }, me);
    await svc.suggestPriority({ title: s(300), description: s(4000), dueDate: s(40) }, me);
    await svc.summarizeProject({ name: s(200), stats: { total: 1_000_000, completed: 1_000_000, inProgress: 1_000_000, overdue: 1_000_000 }, sampleTitles: Array.from({ length: 20 }, () => s(300)) }, me);
    await svc.writeMeetingDescription({ title: s(300), agenda: Array.from({ length: 30 }, () => s(300)), text: s(1000) }, me);
    expect(sizes).toHaveLength(4);
    for (const n of sizes) expect(n).toBeLessThanOrEqual(FITS);
  });

  it('the Final MOM (a meeting far bigger than the facts’ cap)', async () => {
    const { sizes, svc } = measured();
    const facts = minutesFacts({
      meeting: { title: s(300), startAt: new Date('2026-11-11T08:00:00Z'), endAt: new Date('2026-11-11T09:00:00Z'), timeZone: 'Asia/Muscat', description: s(60_000), organizerName: s(383) },
      attendees: [],
      agenda: [],
      notes: [],
      companyTimeZone: 'Asia/Muscat',
    } as never);
    await svc.draftMinutes(facts, me);
    expect(sizes[0]).toBeLessThanOrEqual(FITS);
  });

  it('AI search: understanding the question and answering from 30 items', async () => {
    const prompts: number[] = [];
    const hit = (i: number): SearchHit =>
      ({
        kind: 'task', id: id(i), key: `P000000001-${i}`, title: s(500), titleRanges: [], context: s(500),
        project: { id: 'p1', code: 'P000000001', name: s(191), archived: false, color: '#000', icon: null, imageUrl: null },
        status: { label: s(60), category: 'TODO', done: false }, date: null, people: null,
        matches: Array.from({ length: 5 }, () => ({ field: 'description', label: 'Description', snippet: s(400), ranges: [] })),
        target: { type: 'task', taskId: id(i) },
      }) as unknown as SearchHit;
    const search = createAiSearch({
      ai: {
        chatReady: async () => true,
        startSearchQuestion: () => undefined,
        chat: async (input) => {
          prompts.push(input.system.length + input.prompt.length);
          return prompts.length === 1 ? '{"keywords":["pump"]}' : '{"answer":"a","best":["R1"]}';
        },
      },
      candidates: async () => Array.from({ length: 40 }, (_, i) => hit(i)),
      projects: async () => projects.map((p) => ({ id: p.id, code: p.code, name: p.name })),
      timeZone: 'Asia/Muscat',
    });
    const out = await search.ask({ q: s(2000), viewer: { id: 'u1', roles: [] }, scope: { projectIds: null, meetings: { full: [], invitee: [], editable: [] } } as never, filters: {} });
    expect(out.state).toBe('ok');
    expect(prompts).toHaveLength(2);
    for (const n of prompts) expect(n).toBeLessThanOrEqual(FITS);
  });

  it('MICO AI: its rules and tools, plus the most its prompt may hold (PROMPT_BUDGET)', () => {
    const { catalogue } = createMicoAiTools({ data: {} as never, timeZone: 'Asia/Muscat' });
    const ctx = { today: '2026-11-11', todayLabel: 'Wednesday 11 November 2026', timeZone: 'America/Argentina/ComodRivadavia', userName: s(383) };
    const system = systemPrompt(catalogue, ctx, 6, true);
    expect(system.length + PROMPT_BUDGET).toBeLessThanOrEqual(FITS);
  });

  it('reading pictures (the pictures travel as images, not text)', async () => {
    const { sizes } = measured();
    const ocrConfig: AiConfig = { ...mico, models: [{ ...mico.models[0]!, id: 'o1', modelKey: 'glm-ocr:latest', capabilities: ['vision', 'ocr', 'document'] }] };
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { messages: Array<{ content: unknown }> };
      sizes.push(body.messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : (m.content as Array<{ type: string; text?: string }>).filter((p) => p.type === 'text').reduce((k, p) => k + (p.text ?? '').length, 0)), 0));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'text' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const svc = createAiFeatureService({ repo: createMemoryAiConfigRepository(ocrConfig), fetchImpl });
    await svc.readPictures([{ data: Buffer.from('x'), mimeType: 'image/jpeg' }]);
    expect(sizes[0]).toBeLessThanOrEqual(FITS);
  });
});

