import { describe, it, expect } from 'vitest';
import { changeKind, draftFromQuiz, newQuestion, quizProblems, toQuizInput, type OptionDraft, type QuestionDraft, type QuizDraft } from './quiz-rules';
import { quiz } from './test-api';

const base = (): QuizDraft => draftFromQuiz(quiz());
const withQuestions = (...qs: QuizDraft['questions']): QuizDraft => ({ ...base(), questions: qs });
const single = (texts: string[], right: number[]): QuestionDraft => {
  const q = newQuestion('SINGLE');
  return { ...q, prompt: 'Where do new tasks go?', options: texts.map((text, i): OptionDraft => ({ key: `o${i}`, text, correct: right.includes(i), feedback: '' })) };
};

describe('quiz rules (the editor checks what the server checks before Publish)', () => {
  it('needs at least one question and a pass mark from 1 to 100', () => {
    expect(quizProblems(base())).toContain('Add at least one question.');
    const d = withQuestions(single(['To do', 'Done'], [0]));
    expect(quizProblems(d)).toEqual([]);
    expect(quizProblems({ ...d, passMark: '0' })).toContain('Set a pass mark from 1 to 100%.');
    expect(quizProblems({ ...d, passMark: '101' })).toContain('Set a pass mark from 1 to 100%.');
  });

  it('single choice and true/false: exactly one right answer; multiple: at least one; order: at least two steps', () => {
    expect(quizProblems(withQuestions(single(['A', 'B'], [])))).toEqual(['Question 1: mark exactly one right answer (of at least two).']);
    expect(quizProblems(withQuestions(single(['A', 'B'], [0, 1])))).toEqual(['Question 1: mark exactly one right answer (of at least two).']);
    expect(quizProblems(withQuestions(single(['A'], [0])))).toEqual(['Question 1: mark exactly one right answer (of at least two).']);
    const multiple = { ...single(['A', 'B', 'C'], []), kind: 'MULTIPLE' as const };
    expect(quizProblems(withQuestions(multiple))).toEqual(['Question 1: mark at least one right answer (of at least two).']);
    expect(quizProblems(withQuestions({ ...multiple, options: multiple.options.map((o, i) => ({ ...o, correct: i > 0 })) }))).toEqual([]);
    const tf = { ...changeKind(single(['A', 'B'], [0]), 'TRUE_FALSE'), prompt: 'Tasks can be undone' };
    expect(tf.options.map((o) => o.text)).toEqual(['True', 'False']);
    expect(quizProblems(withQuestions(tf))).toEqual(['Question 1: say whether True or False is right.']);
    expect(quizProblems(withQuestions({ ...tf, options: tf.options.map((o, i) => ({ ...o, correct: i === 1 })) }))).toEqual([]);
    const order = { ...changeKind(single(['First'], []), 'ORDER'), options: [{ key: 'x', text: 'First', correct: false, feedback: '' }] };
    expect(quizProblems(withQuestions(order))).toEqual(['Question 1: give at least two steps to put in order.']);
  });

  it('every question and answer has words', () => {
    expect(quizProblems(withQuestions({ ...single(['A', 'B'], [0]), prompt: ' ' }))).toEqual(['Question 1: write the question.']);
    expect(quizProblems(withQuestions(single(['A', ''], [0])))).toEqual(['Question 1: fill in every answer, or remove the empty one.']);
  });

  it('a question bank can’t draw more questions than it has; attempts and time limits are in range', () => {
    const d = withQuestions(single(['A', 'B'], [0]), single(['C', 'D'], [1]));
    expect(quizProblems({ ...d, bank: true, drawCount: '3' })).toEqual(['The quiz draws 3 questions but has only 2.']);
    expect(quizProblems({ ...d, bank: true, drawCount: '2' })).toEqual([]);
    expect(quizProblems({ ...d, unlimited: false, maxAttempts: '0' })).toEqual(['Allow from 1 to 50 attempts, or Unlimited.']);
    expect(quizProblems({ ...d, timed: true, timeLimit: '' })).toEqual(['Give a time limit from 1 to 240 minutes, or none.']);
  });

  it('is sent as the server takes it (ids kept for the per-question report; order steps all right; empty words null)', () => {
    const q = { ...single(['To do', 'Done'], [1]), id: 'q1', explanation: '  ' };
    q.options[0] = { ...q.options[0]!, id: 'o-a', feedback: 'Not yet' };
    const order = { ...changeKind(newQuestion('SINGLE'), 'ORDER'), prompt: 'Put in order', options: [{ key: 'a', text: 'Open', correct: false, feedback: '' }, { key: 'b', text: 'Close', correct: false, feedback: '' }] };
    const d: QuizDraft = { ...withQuestions(q, order), passMark: '80', unlimited: false, maxAttempts: '3', shuffle: true, timed: true, timeLimit: '15', bank: true, drawCount: '1' };
    expect(toQuizInput(d)).toEqual({
      passMark: 80,
      maxAttempts: 3,
      shuffle: true,
      timeLimitMinutes: 15,
      drawCount: 1,
      questions: [
        { id: 'q1', kind: 'SINGLE', prompt: 'Where do new tasks go?', explanation: null, options: [{ id: 'o-a', text: 'To do', correct: false, feedback: 'Not yet' }, { text: 'Done', correct: true, feedback: null }] },
        { kind: 'ORDER', prompt: 'Put in order', explanation: null, options: [{ text: 'Open', correct: true, feedback: null }, { text: 'Close', correct: true, feedback: null }] },
      ],
    });
    expect(toQuizInput({ ...d, unlimited: true, timed: false, bank: false })).toMatchObject({ maxAttempts: null, timeLimitMinutes: null, drawCount: null });
  });

  it('reads a saved quiz back into the editor', () => {
    const d = draftFromQuiz(
      quiz({
        passMark: 80,
        maxAttempts: 2,
        timeLimitMinutes: 10,
        drawCount: 1,
        questions: [{ id: 'q1', kind: 'TRUE_FALSE', prompt: 'Sure?', explanation: 'Because.', options: [{ id: 't', text: 'True', correct: false, feedback: null }, { id: 'f', text: 'False', correct: true, feedback: 'Right' }] }],
      }),
    );
    expect(d).toMatchObject({ passMark: '80', unlimited: false, maxAttempts: '2', timed: true, timeLimit: '10', bank: true, drawCount: '1' });
    expect(d.questions[0]).toMatchObject({ id: 'q1', kind: 'TRUE_FALSE', prompt: 'Sure?', explanation: 'Because.' });
    expect(d.questions[0]!.options.map((o) => [o.id, o.text, o.correct, o.feedback])).toEqual([['t', 'True', false, ''], ['f', 'False', true, 'Right']]);
  });
});
