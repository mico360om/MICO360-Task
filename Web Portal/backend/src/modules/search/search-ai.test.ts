import { describe, it, expect } from 'vitest';
import { createAiSearch, type AiSearchDeps } from './search-ai';
import { AiRateLimitedError } from '../ai/ai-limits';
import type { SearchHit } from './search-types';
import type { SearchScopeAll } from './search-scope';

const scope: SearchScopeAll = { projectIds: ['p1'], meetings: { full: [], invitee: [], editable: [] } };
const hit = (id: string, title: string, kind: SearchHit['kind'] = 'task'): SearchHit => ({
  kind, id, title, titleRanges: [], project: { id: 'p1', code: 'RIG', name: 'Rig', archived: false, color: '#000', icon: null, imageUrl: null },
  status: { label: 'To do', category: 'TODO', done: false }, date: null, people: null, matches: [{ field: 'description', label: 'Description', snippet: `about ${title}`, ranges: [] }],
  target: { type: 'task', taskId: id },
});
const visible = [hit('t1', 'Rewire the panel'), hit('t2', 'Electrical isolation'), hit('t3', 'Cable tray')];

function deps(replies: string[], over: Partial<AiSearchDeps> = {}): AiSearchDeps & { prompts: string[]; engineCalls: unknown[] } {
  const prompts: string[] = [];
  const engineCalls: unknown[] = [];
  return {
    prompts,
    engineCalls,
    ai: {
      chatReady: async () => true,
      startSearchQuestion: () => undefined,
      chat: async (input) => {
        prompts.push(`${input.system}\n---\n${input.prompt}`);
        const r = replies.shift();
        if (r === undefined) throw new Error('no reply');
        return r;
      },
    },
    candidates: async (input) => {
      engineCalls.push(input);
      return visible.filter((h) => !input.only || input.only.some((o) => o.id === h.id));
    },
    projects: async () => [{ id: 'p1', code: 'RIG', name: 'Rig' }],
    timeZone: 'Asia/Muscat',
    now: () => new Date('2026-11-04T08:00:00Z'),
    ...over,
  };
}

const ask = (d: AiSearchDeps, q = 'electrical work this week on Rig') => createAiSearch(d).ask({ q, viewer: { id: 'u1', roles: [] }, scope, filters: {} });

describe('AI search', () => {
  it('turns the question into words and filters, gathers what the person may see, and answers with the best of them', async () => {
    const d = deps([
      JSON.stringify({ keywords: ['electrical'], synonyms: ['wiring', 'cable'], kinds: ['task'], status: 'open', dateFrom: '2026-11-01', dateTo: '2026-11-07', project: 'RIG', mine: false }),
      JSON.stringify({ answer: 'Two tasks on Rig this week are about electrical work.', best: ['R2', 'R1', 'R9'] }),
    ]);
    const out = await ask(d);
    expect(out.state).toBe('ok');
    if (out.state !== 'ok') return;
    expect(out.answer).toBe('Two tasks on Rig this week are about electrical work.');
    expect(out.hits.map((h) => h.id)).toEqual(['t2', 't1']); // R9 isn't one of them: left out
    expect(out.understood).toMatchObject({ keywords: ['electrical'], synonyms: ['wiring', 'cable'], kinds: ['task'], done: false, project: 'RIG' });
    // The candidates were asked for with the words and the filters the question gave.
    expect(d.engineCalls[0]).toMatchObject({ words: ['electrical', 'wiring', 'cable'], kinds: ['task'], done: false, projectId: 'p1' });
    // Company days (Muscat): from the start of 1 Nov to the end of 7 Nov.
    expect(d.engineCalls[0]).toMatchObject({ from: new Date('2026-10-31T20:00:00Z'), to: new Date('2026-11-07T20:00:00Z') });
    // A task's due date by its calendar day (stored as UTC midnight), whatever the company's zone (review M4).
    expect(d.engineCalls[0]).toMatchObject({ dueFrom: new Date('2026-11-01T00:00:00Z'), dueTo: new Date('2026-11-08T00:00:00Z') });
    // Only the person's own candidates reach the model; today's date and their projects are in the plan prompt.
    expect(d.prompts[0]).toContain('Today is 2026-11-04');
    expect(d.prompts[1]).toContain('Electrical isolation');
  });

  it('says so in one line when AI is off, over the person’s limit, slow or failing — never throws', async () => {
    expect(await ask(deps([], { ai: { chatReady: async () => false, startSearchQuestion: () => undefined, chat: async () => '' } }))).toMatchObject({ state: 'off' });
    expect(await ask(deps([], { ai: { chatReady: async () => true, startSearchQuestion: () => { throw new AiRateLimitedError('You’ve reached today’s AI request limit. It resets tomorrow.'); }, chat: async () => '' } }))).toMatchObject({ state: 'limit', message: expect.stringMatching(/limit/) });
    const slow = deps([], { budgetMs: 20, ai: { chatReady: async () => true, startSearchQuestion: () => undefined, chat: (input) => new Promise((_resolve, reject) => input.signal?.addEventListener('abort', () => reject(new Error('aborted')))) } });
    expect(await ask(slow)).toMatchObject({ state: 'slow' });
    expect(await ask(deps(['{}', 'not json at all']))).toMatchObject({ state: 'failed' });
  });

  it('review M5: the 20 seconds hold even for a step that ignores the stop (waiting for a model slot)', async () => {
    const d = deps([JSON.stringify({ keywords: ['power'] })], {
      budgetMs: 50,
      semantic: { ready: async () => true, nearest: () => new Promise(() => {}) },
    });
    const started = Date.now();
    expect(await ask(d, 'power')).toMatchObject({ state: 'slow' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a plan it can’t read: the question’s own words are searched', async () => {
    const d = deps(['nonsense', JSON.stringify({ answer: 'One match.', best: ['R1'] })]);
    const out = await ask(d, 'cable tray');
    expect(out.state).toBe('ok');
    expect(d.engineCalls[0]).toMatchObject({ words: ['cable', 'tray'] });
  });

  it('nothing the person may see: an answer saying so, without asking the model to answer', async () => {
    const d = deps([JSON.stringify({ keywords: ['zzz'] })], { candidates: async () => [] });
    const out = await ask(d, 'zzz');
    expect(out).toMatchObject({ state: 'ok', hits: [] });
    expect(d.prompts).toHaveLength(1);
  });

  it('with meaning search, its nearest items are candidates too — through the same visibility', async () => {
    const d = deps([JSON.stringify({ keywords: ['power'] }), JSON.stringify({ answer: 'Found.', best: ['R1'] })], {
      semantic: { ready: async () => true, nearest: async () => [{ kind: 'task', id: 't3', score: 0.9 }, { kind: 'task', id: 'hidden', score: 0.8 }] },
    });
    const out = await ask(d, 'power');
    expect(d.engineCalls.some((c) => JSON.stringify(c).includes('"only"'))).toBe(true);
    expect(out.state === 'ok' && out.semantic).toBe(true);
    expect(d.prompts[1]).not.toContain('hidden');
  });
});
