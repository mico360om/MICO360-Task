import { useId, useState } from 'react';
import { LIMITS, QUESTION_KINDS, type ManageLesson, type QuestionKind } from '../../../api/training';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';
import { fieldClass } from '../../ui/Field';
import { stayOnEnter } from '../../../lib/enter-key';
import { Glyph, IconButton, Notice, QUESTION_KIND_LABELS, problemText } from './manage-ui';
import { tc, useCourseCache } from './manage-queries';
import { changeKind, draftFromQuiz, draftKey, newQuestion, quizProblems, toQuizInput, type OptionDraft, type QuestionDraft, type QuizDraft } from './quiz-rules';

const KIND_HINT: Record<QuestionKind, string> = {
  SINGLE: 'One right answer.',
  MULTIPLE: 'One or more right answers: all of them must be chosen.',
  TRUE_FALSE: 'Is the statement true or false?',
  ORDER: 'Write the steps in the right order: learners see them shuffled.',
};

/**
 * A quiz lesson: its pass mark, attempts (or unlimited), shuffled order, time limit and question bank, and its
 * questions — single choice, multiple choice, true/false and put-in-order — each with answers, the right ones,
 * feedback per answer and an explanation. Checked as the server checks it; "Save quiz" saves it all at once.
 */
export function QuizEditor({ lesson, courseId }: { lesson: ManageLesson; courseId: string }) {
  const cache = useCourseCache(courseId);
  const ids = { pass: useId(), attempts: useId(), minutes: useId(), draw: useId(), shuffleHint: useId(), problems: useId() };
  const [saved, setSaved] = useState(() => draftFromQuiz(lesson.quiz));
  const [draft, setDraft] = useState<QuizDraft>(saved);
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems = quizProblems(draft);
  const dirty = JSON.stringify(stripKeys(draft)) !== JSON.stringify(stripKeys(saved));

  const set = (p: Partial<QuizDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setOk(false);
  };
  const setQuestion = (key: string, fn: (q: QuestionDraft) => QuestionDraft) => set({ questions: draft.questions.map((q) => (q.key === key ? fn(q) : q)) });
  const moveQuestion = (i: number, by: -1 | 1) => {
    const to = i + by;
    if (to < 0 || to >= draft.questions.length) return;
    const list = [...draft.questions];
    const [q] = list.splice(i, 1);
    list.splice(to, 0, q!);
    set({ questions: list });
  };

  async function save() {
    setChecked(true);
    if (problems.length) return;
    setBusy(true);
    setProblem(null);
    try {
      const next = await tc().saveQuiz(lesson.id, toQuizInput(draft));
      // The server's ids from now on (a later save keeps them: the per-question report follows its questions).
      const fresh = draftFromQuiz(next.quiz);
      setSaved(fresh);
      setDraft(fresh);
      setChecked(false);
      setOk(true);
      cache.replaceLesson(next);
    } catch (err) {
      setProblem(`Couldn’t save the quiz. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-ink">Quiz</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.pass} className="text-sm font-semibold text-ink">Pass mark (%)</label>
          <input id={ids.pass} type="number" inputMode="numeric" min={1} max={100} value={draft.passMark} onChange={(e) => set({ passMark: e.target.value })} onKeyDown={stayOnEnter} className={fieldClass(false, 'w-full sm:w-32')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink">Attempts</span>
            <span className="flex items-center gap-2 text-xs text-ink-2">
              Unlimited
              <Toggle on={draft.unlimited} onChange={() => set({ unlimited: !draft.unlimited })} label="Unlimited attempts" />
            </span>
          </div>
          {!draft.unlimited ? (
            <>
              <label htmlFor={ids.attempts} className="sr-only">Attempts allowed</label>
              <input id={ids.attempts} type="number" inputMode="numeric" min={1} max={LIMITS.maxAttemptsMax} value={draft.maxAttempts} onChange={(e) => set({ maxAttempts: e.target.value })} onKeyDown={stayOnEnter} className={fieldClass(false, 'w-full sm:w-32')} />
            </>
          ) : (
            <p className="text-xs text-ink-2">Learners can try as often as they like.</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink">Time limit</span>
            <Toggle on={draft.timed} onChange={() => set({ timed: !draft.timed })} label="Time limit" />
          </div>
          {draft.timed ? (
            <>
              <label htmlFor={ids.minutes} className="sr-only">Minutes allowed</label>
              <div className="flex items-center gap-2">
                <input id={ids.minutes} type="number" inputMode="numeric" min={1} max={LIMITS.timeLimitMax} value={draft.timeLimit} onChange={(e) => set({ timeLimit: e.target.value })} onKeyDown={stayOnEnter} className={fieldClass(false, 'w-full sm:w-32')} />
                <span className="text-sm text-ink-2">minutes</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-ink-2">No time limit.</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink">Question bank</span>
            <Toggle on={draft.bank} onChange={() => set({ bank: !draft.bank })} label="Question bank" />
          </div>
          {draft.bank ? (
            <>
              <label htmlFor={ids.draw} className="text-xs text-ink-2">Questions drawn for each attempt</label>
              <div className="flex items-center gap-2">
                <input id={ids.draw} type="number" inputMode="numeric" min={1} max={Math.max(1, draft.questions.length)} value={draft.drawCount} onChange={(e) => set({ drawCount: e.target.value })} onKeyDown={stayOnEnter} className={fieldClass(false, 'w-full sm:w-32')} />
                <span className="text-sm text-ink-2">{`of ${draft.questions.length}`}</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-ink-2">Every question, every attempt.</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-ink">Shuffle the questions</span>
            <span id={ids.shuffleHint} className="block text-xs text-ink-2">A different order for each attempt.</span>
          </div>
          <Toggle on={draft.shuffle} onChange={() => set({ shuffle: !draft.shuffle })} label="Shuffle the questions" describedBy={ids.shuffleHint} />
        </div>
      </div>

      <ol aria-label="Questions" className="flex flex-col gap-3">
        {draft.questions.map((q, i) => (
          <QuestionEditor
            key={q.key}
            question={q}
            index={i}
            last={i === draft.questions.length - 1}
            onChange={(fn) => setQuestion(q.key, fn)}
            onMove={(by) => moveQuestion(i, by)}
            onRemove={() => set({ questions: draft.questions.filter((x) => x.key !== q.key) })}
          />
        ))}
      </ol>
      {draft.questions.length === 0 ? <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">No questions yet.</p> : null}

      {checked && problems.length ? (
        <div id={ids.problems} role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <p className="font-semibold">Fix these first:</p>
          <ul className="mt-1 list-disc ps-5">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      ) : null}
      {problem ? <Notice>{problem}</Notice> : null}
      {ok && !dirty ? <Notice tone="ok">Quiz saved.</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={draft.questions.length >= LIMITS.questionsPerQuiz} onClick={() => set({ questions: [...draft.questions, newQuestion('SINGLE')] })} className="[@media(pointer:coarse)]:!min-h-11">
          {Glyph.plus}
          Add question
        </Button>
        <Button type="button" size="sm" loading={busy} disabled={!dirty && !problems.length} onClick={() => void save()} className="[@media(pointer:coarse)]:!min-h-11">Save quiz</Button>
        {dirty ? <span className="text-xs font-medium text-ink-2">Changes not saved yet</span> : null}
      </div>
    </div>
  );
}

const stripKeys = (d: QuizDraft) => ({ ...d, questions: d.questions.map(({ key: _k, options, ...q }) => ({ ...q, options: options.map(({ key: _o, ...o }) => o) })) });

function QuestionEditor({ question: q, index, last, onChange, onMove, onRemove }: { question: QuestionDraft; index: number; last: boolean; onChange: (fn: (q: QuestionDraft) => QuestionDraft) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const ids = { kind: useId(), prompt: useId(), explanation: useId(), kindHint: useId() };
  const n = index + 1;
  const name = `Question ${n}`;
  const fixed = q.kind === 'TRUE_FALSE';
  const setOption = (key: string, p: Partial<OptionDraft>) => onChange((x) => ({ ...x, options: x.options.map((o) => (o.key === key ? { ...o, ...p } : o)) }));
  const markRight = (key: string) =>
    onChange((x) => ({ ...x, options: x.options.map((o) => (x.kind === 'MULTIPLE' ? (o.key === key ? { ...o, correct: !o.correct } : o) : { ...o, correct: o.key === key })) }));
  const moveOption = (i: number, by: -1 | 1) =>
    onChange((x) => {
      const to = i + by;
      if (to < 0 || to >= x.options.length) return x;
      const list = [...x.options];
      const [o] = list.splice(i, 1);
      list.splice(to, 0, o!);
      return { ...x, options: list };
    });
  const word = q.kind === 'ORDER' ? 'Step' : 'Answer';

  return (
    <li className="rounded-xl border border-line p-3">
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="sr-only">{name}</legend>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="flex-1 text-sm font-bold text-ink">{name}</span>
          <IconButton label={`Move question ${n} up`} disabled={index === 0} onClick={() => onMove(-1)}>{Glyph.up}</IconButton>
          <IconButton label={`Move question ${n} down`} disabled={last} onClick={() => onMove(1)}>{Glyph.down}</IconButton>
          <IconButton label={`Remove question ${n}`} tone="danger" onClick={onRemove}>{Glyph.trash}</IconButton>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.kind} className="text-sm font-semibold text-ink">{`${name}: kind`}</label>
          <select id={ids.kind} value={q.kind} onChange={(e) => onChange((x) => changeKind(x, e.target.value as QuestionKind))} aria-describedby={ids.kindHint} className={fieldClass(false, 'w-full sm:w-64')}>
            {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>)}
          </select>
          <p id={ids.kindHint} className="text-xs text-ink-2">{KIND_HINT[q.kind]}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.prompt} className="text-sm font-semibold text-ink">{name}</label>
          <textarea id={ids.prompt} rows={2} dir="auto" value={q.prompt} maxLength={LIMITS.questionPrompt} onChange={(e) => onChange((x) => ({ ...x, prompt: e.target.value }))} placeholder={q.kind === 'TRUE_FALSE' ? 'A statement to judge' : 'The question'} className={fieldClass(false, 'w-full resize-y')} />
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold text-ink">{q.kind === 'ORDER' ? `${name}: steps, in the right order` : `${name}: answers`}</legend>
          <ul className="flex flex-col gap-2">
            {q.options.map((o, oi) => {
              const label = `${name}, ${word.toLowerCase()} ${oi + 1}`;
              return (
                <li key={o.key} className="flex flex-col gap-1.5 rounded-lg bg-ground p-2 sm:flex-row sm:items-start">
                  <div className="flex flex-none items-center gap-2 sm:pt-2">
                    {q.kind === 'ORDER' ? (
                      <span className="w-6 text-center text-sm font-semibold text-ink-2" aria-hidden="true">{oi + 1}</span>
                    ) : (
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-2 [@media(pointer:coarse)]:min-h-11">
                        <input
                          type={q.kind === 'MULTIPLE' ? 'checkbox' : 'radio'}
                          name={`${q.key}-right`}
                          checked={o.correct}
                          onChange={() => markRight(o.key)}
                          aria-label={`${label} is right`}
                          className="h-4 w-4 accent-brand"
                        />
                        Right
                      </label>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <input aria-label={label} value={o.text} readOnly={fixed} onChange={(e) => setOption(o.key, { text: e.target.value })} onKeyDown={stayOnEnter} maxLength={LIMITS.optionText} dir="auto" className={fieldClass(false, `w-full ${fixed ? 'bg-ground' : ''}`)} />
                    {q.kind !== 'ORDER' ? (
                      <input aria-label={`${label}: feedback`} value={o.feedback} onChange={(e) => setOption(o.key, { feedback: e.target.value })} onKeyDown={stayOnEnter} maxLength={LIMITS.optionFeedback} dir="auto" placeholder="Feedback when chosen (optional)" className={fieldClass(false, 'w-full text-xs')} />
                    ) : null}
                  </div>
                  {!fixed ? (
                    <div className="flex flex-none items-center">
                      {q.kind === 'ORDER' ? (
                        <>
                          <IconButton label={`Move ${label} up`} disabled={oi === 0} onClick={() => moveOption(oi, -1)}>{Glyph.up}</IconButton>
                          <IconButton label={`Move ${label} down`} disabled={oi === q.options.length - 1} onClick={() => moveOption(oi, 1)}>{Glyph.down}</IconButton>
                        </>
                      ) : null}
                      <IconButton label={`Remove ${label}`} tone="danger" disabled={q.options.length <= 1} onClick={() => onChange((x) => ({ ...x, options: x.options.filter((y) => y.key !== o.key) }))}>{Glyph.close}</IconButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!fixed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={q.options.length >= LIMITS.optionsPerQuestion}
              onClick={() => onChange((x) => ({ ...x, options: [...x.options, { key: draftKey(), text: '', correct: false, feedback: '' }] }))}
              className="mt-2 [@media(pointer:coarse)]:!min-h-11"
            >
              {Glyph.plus}
              {q.kind === 'ORDER' ? 'Add step' : 'Add answer'}
            </Button>
          ) : null}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.explanation} className="text-sm font-semibold text-ink">
            {`${name}: explanation`}
            <span className="font-normal text-ink-2"> (optional, shown after it is handed in)</span>
          </label>
          <textarea id={ids.explanation} rows={2} dir="auto" value={q.explanation} maxLength={LIMITS.questionExplanation} onChange={(e) => onChange((x) => ({ ...x, explanation: e.target.value }))} className={fieldClass(false, 'w-full resize-y')} />
        </div>
      </fieldset>
    </li>
  );
}
