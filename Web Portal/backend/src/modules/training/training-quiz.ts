import { ValidationError } from '../../lib/http-errors';
import type { AttemptResultQuestion, PaperQuestion, QuestionKind } from './training-types';

/**
 * Quizzes (ruling R12), pure. An attempt's paper — the questions drawn, their order, the option order,
 * what is right and the feedback — is kept on the server (training_attempts.paper) and NEVER sent before
 * the attempt is handed in: the browser gets paperForBrowser() only. Marking is all-or-nothing per
 * question; the score is right ÷ questions × 100 rounded down.
 */

export interface StoredOption {
  id: string;
  text: string;
  correct: boolean;
  feedback: string | null;
  /** The authored position: for ORDER questions, the right place. */
  position: number;
}

export interface StoredQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  explanation: string | null;
  position: number;
  options: StoredOption[];
}

/** The attempt's paper: questions and options in the order drawn for it. */
export interface Paper {
  passMark: number;
  questions: StoredQuestion[];
}

export type Rng = () => number;

/** A small deterministic RNG for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const byPosition = <T extends { position: number; id: string }>(a: T, b: T) => a.position - b.position || (a.id < b.id ? -1 : 1);

/** R12: draw N from the bank, shuffle the questions when asked, ORDER options always shuffled. */
export function drawPaper(quiz: { passMark: number; shuffle: boolean; drawCount: number | null }, questions: readonly StoredQuestion[], rng: Rng): Paper {
  let picked = [...questions].sort(byPosition);
  if (quiz.drawCount !== null && quiz.drawCount > 0 && quiz.drawCount < picked.length) {
    const chosen = new Set(shuffled(picked, rng).slice(0, quiz.drawCount).map((q) => q.id));
    picked = picked.filter((q) => chosen.has(q.id));
  }
  if (quiz.shuffle) picked = shuffled(picked, rng);
  return {
    passMark: quiz.passMark,
    questions: picked.map((q) => {
      const options = [...q.options].sort(byPosition).map((o) => ({ ...o }));
      if (q.kind !== 'ORDER' || options.length < 2) return { ...q, options };
      // Never handed out already in the right order (a few tries are plenty).
      let order = shuffled(options, rng);
      for (let i = 0; i < 5 && order.every((o, k) => o.id === options[k]!.id); i++) order = shuffled(options, rng);
      if (order.every((o, k) => o.id === options[k]!.id)) order = [...options.slice(1), options[0]!];
      return { ...q, options: order };
    }),
  };
}

/** What the browser gets before hand-in: never what is right, the feedback or the explanation. */
export function paperForBrowser(p: Paper): PaperQuestion[] {
  return p.questions.map((q) => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options.map((o) => ({ id: o.id, text: o.text })) }));
}

/** The browser's answers checked against the paper (400 for anything it doesn't hold). */
export function cleanAnswers(p: Paper, raw: unknown): Record<string, string[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('Send the answers as question → chosen answers.');
  const out: Record<string, string[]> = {};
  for (const [qid, value] of Object.entries(raw as Record<string, unknown>)) {
    const q = p.questions.find((x) => x.id === qid);
    if (!q) throw new ValidationError('That question isn’t on this quiz.');
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new ValidationError('Send each question’s answers as a list.');
    const ids = value as string[];
    if (ids.some((id) => !q.options.some((o) => o.id === id))) throw new ValidationError('That answer isn’t one of the question’s answers.');
    if (q.kind === 'ORDER') {
      if (new Set(ids).size !== ids.length) throw new ValidationError('Put each step in the order once.');
      out[qid] = ids;
      continue;
    }
    const unique = [...new Set(ids)];
    if ((q.kind === 'SINGLE' || q.kind === 'TRUE_FALSE') && unique.length > 1) throw new ValidationError('Choose one answer for this question.');
    out[qid] = unique;
  }
  return out;
}

function isRight(q: StoredQuestion, chosen: readonly string[]): boolean {
  if (q.kind === 'ORDER') {
    const right = [...q.options].sort(byPosition).map((o) => o.id);
    return chosen.length === right.length && chosen.every((id, i) => id === right[i]);
  }
  const correct = new Set(q.options.filter((o) => o.correct).map((o) => o.id));
  const picked = new Set(chosen);
  if (q.kind === 'SINGLE' || q.kind === 'TRUE_FALSE') return picked.size === 1 && correct.has(chosen[0]!);
  return picked.size === correct.size && [...picked].every((id) => correct.has(id));
}

/** The mark: right answers, score (rounded down) and whether it passed. */
export function markPaper(p: Paper, answers: Readonly<Record<string, readonly string[]>>): { right: number; scorePct: number; passed: boolean } {
  const right = p.questions.filter((q) => isRight(q, answers[q.id] ?? [])).length;
  const scorePct = p.questions.length ? Math.floor((right / p.questions.length) * 100) : 0;
  return { right, scorePct, passed: p.questions.length > 0 && scorePct >= p.passMark };
}

/** After hand-in: each question with what was chosen, the right answers, feedback and the explanation. */
export function resultQuestions(p: Paper, answers: Readonly<Record<string, readonly string[]>>): AttemptResultQuestion[] {
  return p.questions.map((q) => {
    const chosen = [...(answers[q.id] ?? [])];
    return {
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      right: isRight(q, chosen),
      chosen,
      explanation: q.explanation,
      options: q.options.map((o) => ({ id: o.id, text: o.text, correct: o.correct, position: o.position, feedback: o.feedback })),
    };
  });
}

/** Saving or handing in after the deadline still counts for this long (a slow connection). */
export const GRACE_MS = 30_000;

export function deadlineOf(startedAt: Date, timeLimitMinutes: number | null): Date | null {
  return timeLimitMinutes ? new Date(startedAt.getTime() + timeLimitMinutes * 60_000) : null;
}

export function timeIsUp(deadline: Date | null, now: Date): boolean {
  return !!deadline && now.getTime() > deadline.getTime() + GRACE_MS;
}
