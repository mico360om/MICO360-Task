import { describe, expect, it } from 'vitest';
import { cleanAnswers, deadlineOf, drawPaper, markPaper, paperForBrowser, resultQuestions, seededRng, timeIsUp, GRACE_MS, type StoredQuestion } from './training-quiz';

const opt = (id: string, position: number, correct = false, feedback: string | null = null) => ({ id, text: `Text ${id}`, correct, feedback, position });
const Q = (id: string, position: number, kind: StoredQuestion['kind'], options: StoredQuestion['options']): StoredQuestion => ({ id, kind, prompt: `Prompt ${id}`, explanation: `Because ${id}`, position, options });
const bank: StoredQuestion[] = [
  Q('s', 0, 'SINGLE', [opt('s1', 0), opt('s2', 1, true, 'Yes!'), opt('s3', 2, false, 'No.')]),
  Q('m', 1, 'MULTIPLE', [opt('m1', 0, true), opt('m2', 1), opt('m3', 2, true)]),
  Q('t', 2, 'TRUE_FALSE', [opt('tt', 0, true), opt('tf', 1)]),
  Q('o', 3, 'ORDER', [opt('o1', 0, true), opt('o2', 1, true), opt('o3', 2, true), opt('o4', 3, true)]),
];
const settings = { passMark: 70, shuffle: false, drawCount: null as number | null };

describe('R12 the paper drawn for an attempt', () => {
  it('every question in order without shuffle; ORDER options always shuffled; True/False as written', () => {
    const p = drawPaper(settings, bank, seededRng(1));
    expect(p.questions.map((q) => q.id)).toEqual(['s', 'm', 't', 'o']);
    expect(p.questions[0]!.options.map((o) => o.id)).toEqual(['s1', 's2', 's3']);
    expect(p.questions[2]!.options.map((o) => o.id)).toEqual(['tt', 'tf']);
    const order = p.questions[3]!.options.map((o) => o.id);
    expect(order.slice().sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(order).not.toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(p.passMark).toBe(70);
  });

  it('shuffle on: the questions in a random order (the RNG decides)', () => {
    const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => drawPaper({ ...settings, shuffle: true }, bank, seededRng(s)).questions.map((q) => q.id).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('a question bank: N questions drawn at random, each once', () => {
    const p = drawPaper({ ...settings, drawCount: 2 }, bank, seededRng(3));
    expect(p.questions).toHaveLength(2);
    expect(new Set(p.questions.map((q) => q.id)).size).toBe(2);
    const seen = new Set<string>();
    for (let s = 1; s < 30; s++) for (const q of drawPaper({ ...settings, drawCount: 2 }, bank, seededRng(s)).questions) seen.add(q.id);
    expect(seen.size).toBe(4);
    expect(drawPaper({ ...settings, drawCount: 10 }, bank, seededRng(1)).questions).toHaveLength(4);
  });

  it('the browser gets the questions and option texts only — never what is right, feedback or explanations', () => {
    const p = drawPaper(settings, bank, seededRng(1));
    const out = paperForBrowser(p);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/correct|feedback|explanation|position|Because|Yes!/);
    expect(out[3]).toEqual({ id: 'o', kind: 'ORDER', prompt: 'Prompt o', options: p.questions[3]!.options.map((o) => ({ id: o.id, text: o.text })) });
  });
});

describe('marking (all or nothing per question; score rounded down)', () => {
  const p = drawPaper(settings, bank, seededRng(1));
  it('every answer right: 100 and passed', () => {
    const r = markPaper(p, { s: ['s2'], m: ['m3', 'm1'], t: ['tt'], o: ['o1', 'o2', 'o3', 'o4'] });
    expect(r).toMatchObject({ scorePct: 100, passed: true, right: 4 });
  });
  it('MULTIPLE needs exactly the right set; ORDER exactly the right order; SINGLE one right option', () => {
    const r = markPaper(p, { s: ['s2'], m: ['m1'], t: ['tf'], o: ['o2', 'o1', 'o3', 'o4'] });
    expect(r).toMatchObject({ scorePct: 25, passed: false, right: 1 });
    expect(markPaper(p, { s: ['s2'], m: ['m1', 'm2', 'm3'], t: ['tt'], o: ['o1', 'o2', 'o3', 'o4'] }).scorePct).toBe(75);
    expect(markPaper(p, {}).scorePct).toBe(0);
  });
  it('the pass mark: at or above it passes', () => {
    const p3 = drawPaper({ ...settings, passMark: 66 }, bank.slice(0, 3), seededRng(1));
    expect(markPaper(p3, { s: ['s2'], m: ['m1', 'm3'], t: ['tf'] })).toMatchObject({ scorePct: 66, passed: true });
  });
  it('after hand-in: right/wrong, what was chosen, the right answers, feedback and the explanation', () => {
    const out = resultQuestions(p, { s: ['s3'], o: ['o1', 'o2', 'o3', 'o4'] });
    expect(out[0]).toEqual({
      id: 's',
      kind: 'SINGLE',
      prompt: 'Prompt s',
      right: false,
      chosen: ['s3'],
      explanation: 'Because s',
      options: [
        { id: 's1', text: 'Text s1', correct: false, position: 0, feedback: null },
        { id: 's2', text: 'Text s2', correct: true, position: 1, feedback: 'Yes!' },
        { id: 's3', text: 'Text s3', correct: false, position: 2, feedback: 'No.' },
      ],
    });
    expect(out[3]!.right).toBe(true);
  });
});

describe('M9 what a hand-in shows before the quiz is passed (or attempts run out)', () => {
  const p = drawPaper(settings, bank, seededRng(1));
  it('right or wrong and the chosen answers’ feedback — never which options are right, their order or the explanation', () => {
    const out = resultQuestions(p, { s: ['s3'], o: ['o2', 'o1', 'o3', 'o4'] }, { reveal: false });
    expect(out[0]).toEqual({
      id: 's',
      kind: 'SINGLE',
      prompt: 'Prompt s',
      right: false,
      chosen: ['s3'],
      explanation: null,
      options: [
        { id: 's1', text: 'Text s1', correct: false, position: 0, feedback: null },
        { id: 's2', text: 'Text s2', correct: false, position: 1, feedback: null },
        { id: 's3', text: 'Text s3', correct: false, position: 2, feedback: 'No.' },
      ],
    });
    // ORDER: the positions are the order handed out, not the right one.
    expect(out[3]!.options.map((o) => o.position)).toEqual([0, 1, 2, 3]);
    expect(out[3]!.options.map((o) => o.id)).toEqual(p.questions[3]!.options.map((o) => o.id));
    expect(JSON.stringify(out)).not.toMatch(/Because|"correct":true/);
  });
});

describe('answers sent by the browser are checked against the paper', () => {
  const p = drawPaper(settings, bank, seededRng(1));
  it('keeps known questions and options; refuses anything else', () => {
    expect(cleanAnswers(p, { s: ['s1'], m: ['m1', 'm1', 'm2'] })).toEqual({ s: ['s1'], m: ['m1', 'm2'] });
    expect(() => cleanAnswers(p, { s: ['m1'] })).toThrow(/answer/);
    expect(() => cleanAnswers(p, { nope: ['s1'] })).toThrow(/question/);
    expect(() => cleanAnswers(p, { s: ['s1', 's2'] })).toThrow(/one answer/);
    expect(() => cleanAnswers(p, { o: ['o1', 'o1'] })).toThrow(/once/);
    expect(() => cleanAnswers(p, 'x')).toThrow();
    expect(() => cleanAnswers(p, { s: 's1' })).toThrow();
    expect(cleanAnswers(p, undefined)).toEqual({});
  });
});

describe('time limits (30 s grace)', () => {
  it('deadline = start + the limit; time is up only after the grace', () => {
    const start = new Date('2026-11-11T10:00:00.000Z');
    expect(deadlineOf(start, null)).toBeNull();
    const d = deadlineOf(start, 10)!;
    expect(d.toISOString()).toBe('2026-11-11T10:10:00.000Z');
    expect(GRACE_MS).toBe(30_000);
    expect(timeIsUp(d, new Date(d.getTime() + 29_000))).toBe(false);
    expect(timeIsUp(d, new Date(d.getTime() + 31_000))).toBe(true);
    expect(timeIsUp(null, new Date('2099-01-01'))).toBe(false);
  });
});
