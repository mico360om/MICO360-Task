import { LIMITS, type ManageQuiz, type QuestionKind, type QuizInput } from '../../../api/training';

/**
 * The quiz editor's draft and its checks — the same rules the server's Publish checks (training-manage.ts
 * publishProblems), said before saving: at least one question; single choice and true/false exactly one right
 * answer; multiple choice at least one; put-in-order at least two steps; a question bank can't draw more than it has.
 */

export interface OptionDraft {
  key: string;
  id?: string;
  text: string;
  correct: boolean;
  feedback: string;
}

export interface QuestionDraft {
  key: string;
  id?: string;
  kind: QuestionKind;
  prompt: string;
  explanation: string;
  options: OptionDraft[];
}

export interface QuizDraft {
  passMark: string;
  unlimited: boolean;
  maxAttempts: string;
  shuffle: boolean;
  timed: boolean;
  timeLimit: string;
  bank: boolean;
  drawCount: string;
  questions: QuestionDraft[];
}

/** What is sent: the server keeps a question's (and an answer's) id when it is sent back, for the per-question report. */
export type QuizSave = QuizInput & {
  questions: (QuizInput['questions'][number] & { id?: string; options: (QuizInput['questions'][number]['options'][number] & { id?: string })[] })[];
};

let seq = 0;
export const draftKey = (): string => `d${++seq}`;

const option = (text = '', correct = false): OptionDraft => ({ key: draftKey(), text, correct, feedback: '' });

/** A new question of a kind: two empty answers (true/false: True and False). */
export function newQuestion(kind: QuestionKind): QuestionDraft {
  return { key: draftKey(), kind, prompt: '', explanation: '', options: kind === 'TRUE_FALSE' ? [option('True'), option('False')] : [option(), option()] };
}

/** The question as another kind: true/false brings True and False; the others keep the answers' words. */
export function changeKind(q: QuestionDraft, kind: QuestionKind): QuestionDraft {
  if (kind === q.kind) return q;
  if (kind === 'TRUE_FALSE') return { ...q, kind, options: [option('True'), option('False')] };
  const fromTf = q.kind === 'TRUE_FALSE';
  const options = fromTf ? [option(), option()] : q.options.map((o) => ({ ...o, correct: kind === 'ORDER' ? false : kind === 'SINGLE' ? false : o.correct }));
  return { ...q, kind, options };
}

export function draftFromQuiz(quiz: ManageQuiz | null): QuizDraft {
  const q = quiz ?? { passMark: 70, maxAttempts: null, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [] };
  return {
    passMark: String(q.passMark),
    unlimited: q.maxAttempts === null,
    maxAttempts: String(q.maxAttempts ?? 3),
    shuffle: q.shuffle,
    timed: q.timeLimitMinutes !== null,
    timeLimit: String(q.timeLimitMinutes ?? 10),
    bank: q.drawCount !== null,
    drawCount: String(q.drawCount ?? Math.max(1, q.questions.length)),
    questions: q.questions.map((x) => ({
      key: draftKey(),
      id: x.id,
      kind: x.kind,
      prompt: x.prompt,
      explanation: x.explanation ?? '',
      options: x.options.map((o) => ({ key: draftKey(), id: o.id, text: o.text, correct: o.correct, feedback: o.feedback ?? '' })),
    })),
  };
}

const whole = (s: string): number | null => {
  const n = Number(s);
  return s.trim() !== '' && Number.isInteger(n) ? n : null;
};
const inRange = (s: string, min: number, max: number) => {
  const n = whole(s);
  return n !== null && n >= min && n <= max;
};

/** Every problem, in plain words (empty: it can be saved). */
export function quizProblems(d: QuizDraft): string[] {
  const out: string[] = [];
  if (!inRange(d.passMark, 1, 100)) out.push('Set a pass mark from 1 to 100%.');
  if (!d.unlimited && !inRange(d.maxAttempts, 1, LIMITS.maxAttemptsMax)) out.push(`Allow from 1 to ${LIMITS.maxAttemptsMax} attempts, or Unlimited.`);
  if (d.timed && !inRange(d.timeLimit, 1, LIMITS.timeLimitMax)) out.push(`Give a time limit from 1 to ${LIMITS.timeLimitMax} minutes, or none.`);
  if (d.questions.length === 0) out.push('Add at least one question.');
  if (d.questions.length > LIMITS.questionsPerQuiz) out.push(`A quiz has at most ${LIMITS.questionsPerQuiz} questions.`);
  d.questions.forEach((q, i) => {
    const at = `Question ${i + 1}`;
    const n = q.options.length;
    const right = q.options.filter((o) => o.correct).length;
    if (!q.prompt.trim()) out.push(`${at}: write the question.`);
    if (q.prompt.length > LIMITS.questionPrompt) out.push(`${at}: use at most ${LIMITS.questionPrompt.toLocaleString('en-US')} characters.`);
    if (q.explanation.length > LIMITS.questionExplanation) out.push(`${at}: keep the explanation to ${LIMITS.questionExplanation.toLocaleString('en-US')} characters.`);
    if (n > LIMITS.optionsPerQuestion) out.push(`${at}: at most ${LIMITS.optionsPerQuestion} answers.`);
    if (q.options.some((o) => !o.text.trim())) out.push(`${at}: fill in every answer, or remove the empty one.`);
    if (q.options.some((o) => o.text.length > LIMITS.optionText || o.feedback.length > LIMITS.optionFeedback)) out.push(`${at}: an answer or its feedback is too long.`);
    if (q.kind === 'SINGLE' && (n < 2 || right !== 1)) out.push(`${at}: mark exactly one right answer (of at least two).`);
    if (q.kind === 'MULTIPLE' && (n < 2 || right < 1)) out.push(`${at}: mark at least one right answer (of at least two).`);
    if (q.kind === 'TRUE_FALSE' && (n !== 2 || right !== 1)) out.push(`${at}: say whether True or False is right.`);
    if (q.kind === 'ORDER' && n < 2) out.push(`${at}: give at least two steps to put in order.`);
  });
  if (d.bank) {
    const draw = whole(d.drawCount);
    if (draw === null || draw < 1) out.push('Draw at least one question for each attempt.');
    else if (draw > d.questions.length) out.push(`The quiz draws ${draw} questions but has only ${d.questions.length}.`);
  }
  return out;
}

/** The draft as PUT /training/manage/lessons/:id/quiz takes it. */
export function toQuizInput(d: QuizDraft): QuizSave {
  return {
    passMark: Number(d.passMark),
    maxAttempts: d.unlimited ? null : Number(d.maxAttempts),
    shuffle: d.shuffle,
    timeLimitMinutes: d.timed ? Number(d.timeLimit) : null,
    drawCount: d.bank ? Number(d.drawCount) : null,
    questions: d.questions.map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      kind: q.kind,
      prompt: q.prompt.trim(),
      explanation: q.explanation.trim() || null,
      options: q.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), text: o.text.trim(), correct: q.kind === 'ORDER' ? true : o.correct, feedback: o.feedback.trim() || null })),
    })),
  };
}
