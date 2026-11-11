import { describe, it, expect } from 'vitest';
import { draftOf, runTurn, type LoopDeps, type ModelRequest } from './mico-ai-loop';
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
    expect(drafts).toEqual([null, 'There are 5 overdue.', null, 'Nothing found.']);
  });
});
