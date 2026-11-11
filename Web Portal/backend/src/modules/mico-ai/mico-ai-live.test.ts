import { describe, it, expect } from 'vitest';
import { draftOf, MAX_TOOL_STEPS, runTurn, systemPrompt, type LoopDeps, type ModelRequest } from './mico-ai-loop';
import { MICO_AI_ACTION_SCHEMA } from '../ai/ai-schemas';

// (b) bundles, b15: MICO360 AI writes MICO AI's reply live; the reply is JSON, so the words a person may
// read while it is written are the answer's "text" (or a question's "question") as far as it has come.
describe('draftOf — the words of a reply still being written', () => {
  it('an answer’s text so far, with its escapes read', () => {
    expect(draftOf('{"action":"answer","text":"Two tasks are over')).toBe('Two tasks are over');
    expect(draftOf('{"action": "answer", "text": "Line one\\nIt said \\"done\\" — \\u0645\\u0631')).toBe('Line one\nIt said "done" — مر');
    expect(draftOf('{"action":"answer","text":"Finished.","tables":[]}')).toBe('Finished.');
  });
  it('a half-written escape is left for the next piece', () => {
    expect(draftOf('{"action":"answer","text":"Half \\')).toBe('Half ');
    expect(draftOf('{"action":"answer","text":"Half \\u06')).toBe('Half ');
  });
  it('a question’s words, and a proposal’s', () => {
    expect(draftOf('{"action":"clarify","question":"Which proj')).toBe('Which proj');
    expect(draftOf('{"action":"propose","text":"I can move these two')).toBe('I can move these two');
    expect(draftOf('{"action":"propose","text":"Move both.","changes":[{"type":"update_task"')).toBe('Move both.');
  });
  it('nothing for a tool step, before the action is known, or before the words start', () => {
    expect(draftOf('{"action":"tool","name":"search_tasks","args":{"text":"x"}}')).toBeNull();
    expect(draftOf('{"text":"Before the action","action":"answer"')).toBeNull();
    expect(draftOf('{"action":"answer","tables":[{"title":"x"}],"te')).toBeNull();
    expect(draftOf('Sure! ```json')).toBeNull();
  });
  it('a text key inside a nested object is not the answer’s', () => {
    expect(draftOf('{"action":"answer","tables":[{"text":"not this"}],"text":"this')).toBe('this');
  });
});

describe('runTurn — live words (b15) and the action schema (b1)', () => {
  const base = (complete: LoopDeps['complete'], drafts: Array<string | null>): LoopDeps => ({
    complete,
    tools: [{ name: 'search_tasks', purpose: 'Find tasks.', args: '{ }', step: () => 'Checking tasks…' }],
    runTool: async (name, args) => ({ tool: name, args, title: 'Tasks', columns: [{ key: 'key', label: 'Task' }], rows: [], total: 0 }),
    context: { today: '2026-11-11', todayLabel: 'Wed 11 Nov 2026', timeZone: 'Asia/Muscat', userName: 'Khurram' },
    onDraft: (t) => void drafts.push(t),
  });
  const input = { question: 'What is overdue?', history: [], summary: null, earlier: [], signal: new AbortController().signal };

  it('each model call is held to the action schema and streams; an answer’s words reach the page as they come, a tool step’s never', async () => {
    const drafts: Array<string | null> = [];
    const asked: ModelRequest[] = [];
    const replies = ['{"action":"tool","name":"search_tasks","args":{}}', '{"action":"answer","text":"Nothing is overdue.","sources":[]}'];
    const complete: LoopDeps['complete'] = async (req) => {
      asked.push(req);
      const reply = replies[asked.length - 1]!;
      // The model writes it in three pieces.
      for (const end of [10, 40, reply.length]) req.onText?.(reply.slice(0, end));
      return reply;
    };
    const out = await runTurn(base(complete, drafts), input);
    expect(out.text).toBe('Nothing is overdue.');
    expect(asked.every((r) => r.schema === MICO_AI_ACTION_SCHEMA && typeof r.onText === 'function')).toBe(true);
    // Cleared as each call starts; the tool step showed nothing; the answer grew.
    expect(drafts).toEqual([null, null, 'Nothing is ov', 'Nothing is overdue.']);
  });

  it('an answer sent back (no data behind its figures) is cleared before the next try', async () => {
    const drafts: Array<string | null> = [];
    const replies = ['{"action":"answer","text":"There are 5 overdue."}', '{"action":"answer","text":"Nothing found.","unavailable":true}'];
    let n = 0;
    const complete: LoopDeps['complete'] = async (req) => {
      const reply = replies[n++]!;
      req.onText?.(reply);
      return reply;
    };
    const out = await runTurn(base(complete, drafts), input);
    expect(out.text).toBe('Nothing found.');
    // Review I2: figures with no data behind them are never shown (that answer is sent back).
    expect(drafts).toEqual([null, null, 'Nothing found.']);
  });
});

// Review I2: the words of a reply the loop may still send back are not shown.
describe('runTurn — live words only for what can be kept', () => {
  const input = { question: 'q', history: [], summary: null, earlier: [], signal: new AbortController().signal };
  const deps = (replies: string[][], drafts: Array<string | null>, propose?: LoopDeps['propose']): LoopDeps => {
    let n = 0;
    return {
      complete: async (req) => {
        const pieces = replies[Math.min(n++, replies.length - 1)]!;
        for (const p of pieces) req.onText?.(p);
        return pieces.at(-1)!;
      },
      tools: [{ name: 'search_tasks', purpose: 'Find tasks.', args: '{ }', step: () => 'Checking tasks…' }],
      runTool: async (name, args) => ({ tool: name, args, title: 'Tasks', columns: [{ key: 'key', label: 'Task' }], rows: [], total: 0 }),
      context: { today: '2026-11-11', todayLabel: 'Wed 11 Nov 2026', timeZone: 'Asia/Muscat', userName: 'K' },
      onDraft: (t) => void drafts.push(t),
      ...(propose ? { propose } : {}),
    };
  };

  it('an answer with no data behind it: its words show until a figure comes, then are taken back', async () => {
    const drafts: Array<string | null> = [];
    await runTurn(deps([['{"action":"answer","text":"There are ', '{"action":"answer","text":"There are 5 overdue."}'], ['{"action":"answer","text":"Nothing found.","unavailable":true}']], drafts), input);
    expect(drafts).toEqual([null, 'There are ', null, null, 'Nothing found.']);
  });

  it('read-only: a proposal’s words are never shown (the loop answers that it can’t make changes)', async () => {
    const drafts: Array<string | null> = [];
    await runTurn(deps([['{"action":"propose","text":"I will move it","changes":[{"type":"update_task"}]}'], ['{"action":"answer","text":"I can’t make changes here."}']], drafts), input);
    expect(drafts.filter((d) => d && /move it/.test(d))).toEqual([]);
  });
});

// Review minor 6: on MICO360 AI's live stream the instructions travel as `system`, at most 8,000 characters
// (guide §5 Prompts; 413 over it). complete() then uses /v1 instead — this keeps MICO AI on the stream.
describe('MICO AI’s instructions fit the native API', () => {
  it('the rules, the tools and the change types together stay under 8,000 characters', async () => {
    const { createMicoAiTools } = await import('./mico-ai-tools');
    const { createMemoryMicoAiData, company, NOW } = await import('./mico-ai-data.fixture');
    const { NATIVE_SYSTEM_LIMIT } = await import('../ai/ai-completion');
    const tools = createMicoAiTools({ data: createMemoryMicoAiData(company()), timeZone: 'Asia/Muscat', now: () => NOW }).catalogue;
    const ctx = { today: '2026-11-11', todayLabel: 'Wed 11 Nov 2026', timeZone: 'Asia/Muscat', userName: 'x'.repeat(200) };
    const longest = systemPrompt(tools, ctx, MAX_TOOL_STEPS, true);
    expect(longest.length).toBeLessThanOrEqual(NATIVE_SYSTEM_LIMIT - 300); // with room to grow a little
  });
});
