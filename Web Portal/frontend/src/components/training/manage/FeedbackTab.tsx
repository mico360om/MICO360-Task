import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, LIMITS, type FeedbackItem, type FeedbackKind, type FeedbackStatus } from '../../../api/training';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { LoadError } from '../../ui/LoadError';
import { fieldClass } from '../../ui/Field';
import { useCompanyTimeZone } from '../../../lib/useCompanyTimeZone';
import { FilterField, Notice, SectionCard, Stars, count, instantWords, problemText } from './manage-ui';
import { MANAGE_KEY, manageKeys, tc } from './manage-queries';

const KIND_LABELS: Record<FeedbackKind, string> = { QUESTION: 'Questions', OUTDATED: 'Outdated reports', RATING: 'Ratings' };
const STATUS_LABELS: Record<FeedbackStatus, string> = { OPEN: 'Open', ANSWERED: 'Answered', FIXED: 'Fixed' };
const STATUS_TONE: Record<FeedbackStatus, BadgeTone> = { OPEN: 'info', ANSWERED: 'success', FIXED: 'success' };

/** "4.5", "2": an average to one decimal place, without a trailing ".0". */
const averageText = (n: number) => String(Number(n.toFixed(1)));

interface CourseRatings {
  courseId: string;
  courseTitle: string;
  average: number;
  items: FeedbackItem[];
}

/** Ratings by course, the best rated first (each with its average). */
export function ratingsByCourse(items: readonly FeedbackItem[]): CourseRatings[] {
  const by = new Map<string, CourseRatings>();
  for (const f of items) {
    if (f.kind !== 'RATING' || f.rating === null) continue;
    const g = by.get(f.courseId) ?? { courseId: f.courseId, courseTitle: f.courseTitle, average: 0, items: [] };
    g.items.push(f);
    by.set(f.courseId, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, average: g.items.reduce((s, f) => s + (f.rating ?? 0), 0) / g.items.length }))
    .sort((a, b) => b.average - a.average || a.courseTitle.localeCompare(b.courseTitle));
}

/**
 * Feedback: learners' questions (answered here — the asker is told), "outdated" reports on lessons (marked
 * fixed) and ratings (stars and comments, averaged per course). A Training manager sees her companies' people.
 */
export function FeedbackTab() {
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const ids = { kind: useId(), status: useId() };
  const [kind, setKind] = useState<FeedbackKind | ''>('');
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [done, setDone] = useState<string | null>(null);
  const filter = { kind, status };
  const listQ = useQuery({ queryKey: manageKeys.feedback(filter), queryFn: () => tc().feedbackList(filter) });
  const items = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const refresh = () => void qc.invalidateQueries({ queryKey: [...MANAGE_KEY, 'feedback'] });
  const fixed = useMutation({ mutationFn: (id: string) => tc().markFixed(id), onSuccess: refresh });
  const shows = (k: FeedbackKind) => !kind || kind === k;
  const meta = (f: FeedbackItem) => [f.courseTitle, f.byName ?? null, instantWords(f.createdAt, timeZone)].filter(Boolean).join(' · ');
  const questions = items.filter((f) => f.kind === 'QUESTION');
  const outdated = items.filter((f) => f.kind === 'OUTDATED');
  const ratings = ratingsByCourse(items);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="Kind" htmlFor={ids.kind} className="min-w-[10rem] flex-1 sm:max-w-xs">
          <select id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind | '')} className={fieldClass(false, 'w-full')}>
            <option value="">All feedback</option>
            {(['QUESTION', 'OUTDATED', 'RATING'] as const).filter((k) => FEEDBACK_KINDS.includes(k)).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </FilterField>
        <FilterField label="Status" htmlFor={ids.status} className="min-w-[9rem] flex-1 sm:max-w-xs">
          <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus | '')} className={fieldClass(false, 'w-full')}>
            <option value="">All</option>
            {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </FilterField>
      </div>
      {done ? <Notice tone="ok">{done}</Notice> : null}
      {fixed.isError ? <Notice>{`Couldn’t mark it fixed. ${problemText(fixed.error)}`}</Notice> : null}

      {listQ.isError ? (
        <LoadError what="the feedback" onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="skeleton h-48 rounded-2xl" role="status" aria-label="Loading feedback" />
      ) : items.length === 0 ? (
        <EmptyState title="No feedback here" description="Questions, “outdated” reports and ratings from learners show here." />
      ) : (
        <>
          {shows('QUESTION') ? (
            <SectionCard id="tc-fb-questions" title="Questions" description="Answer here: the person who asked is told, and everyone taking the course sees the answer (without names).">
              {questions.length === 0 ? (
                <p className="text-sm text-ink-2">No questions.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {questions.map((f) => (
                    <QuestionItem key={f.id} item={f} meta={meta(f)} answeredOn={instantWords(f.answeredAt, timeZone)} onAnswered={(who) => {
                      setDone(`Answer sent. ${who} is told.`);
                      refresh();
                    }} />
                  ))}
                </ul>
              )}
            </SectionCard>
          ) : null}
          {shows('OUTDATED') ? (
            <SectionCard id="tc-fb-outdated" title="Outdated reports" description="Lessons learners say no longer match the site. Fix the lesson, then mark the report fixed.">
              {outdated.length === 0 ? (
                <p className="text-sm text-ink-2">No reports.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {outdated.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-2.5">
                      <div className="min-w-0 flex-[1_1_16rem]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span dir="auto" className="text-sm font-semibold text-ink">{f.lessonTitle ? `Lesson: ${f.lessonTitle}` : 'The whole course'}</span>
                          <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABELS[f.status]}</Badge>
                        </div>
                        {f.body ? <p dir="auto" className="mt-0.5 whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">{f.body}</p> : null}
                        <p className="mt-0.5 text-xs text-ink-2">{meta(f)}</p>
                      </div>
                      {f.status === 'OPEN' ? (
                        <Button variant="secondary" size="sm" loading={fixed.isPending && fixed.variables === f.id} onClick={() => fixed.mutate(f.id)} className="[@media(pointer:coarse)]:!min-h-11">
                          Mark fixed
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          ) : null}
          {shows('RATING') ? (
            <SectionCard id="tc-fb-ratings" title="Ratings">
              {ratings.length === 0 ? (
                <p className="text-sm text-ink-2">No ratings.</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {ratings.map((g) => (
                    <li key={g.courseId} className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 dir="auto" className="font-semibold text-ink">{g.courseTitle}</h3>
                        <Stars value={g.average} />
                        <span className="text-sm text-ink-2">{`${averageText(g.average)} average · ${count(g.items.length, 'rating')}`}</span>
                      </div>
                      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                        {g.items.map((f) => (
                          <li key={f.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                            <Stars value={f.rating ?? 0} />
                            <div className="min-w-0 flex-1">
                              {f.body ? <p dir="auto" className="whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">{f.body}</p> : <p className="text-sm text-ink-3">No comment</p>}
                              <p className="text-xs text-ink-2">{[f.byName, instantWords(f.createdAt, timeZone)].filter(Boolean).join(' · ')}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          ) : null}
        </>
      )}
    </div>
  );
}

function QuestionItem({ item, meta, answeredOn, onAnswered }: { item: FeedbackItem; meta: string; answeredOn: string; onAnswered: (who: string) => void }) {
  const boxId = useId();
  const errId = useId();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const who = item.byName ?? 'The person who asked';
  const send = useMutation({
    mutationFn: (answer: string) => tc().answer(item.id, answer),
    onSuccess: () => {
      setText('');
      onAnswered(who);
    },
    onError: (err) => setProblem(`Couldn’t send the answer. ${problemText(err)}`),
  });
  const submit = () => {
    const answer = text.trim();
    if (!answer) return setProblem('Write an answer first.');
    setProblem(null);
    send.mutate(answer);
  };
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p dir="auto" className="min-w-0 whitespace-pre-line font-medium text-ink [overflow-wrap:anywhere]">{item.body}</p>
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</Badge>
      </div>
      <p className="mt-0.5 text-xs text-ink-2">{meta}</p>
      {item.status === 'ANSWERED' && item.answer ? (
        <div className="mt-2 rounded-lg bg-ground px-3 py-2">
          <p dir="auto" className="whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">{item.answer}</p>
          {answeredOn ? <p className="mt-0.5 text-xs text-ink-2">{`Answered ${answeredOn}`}</p> : null}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <label htmlFor={boxId} className="sr-only">{`Your answer to ${who}`}</label>
          <textarea
            id={boxId}
            rows={2}
            dir="auto"
            value={text}
            maxLength={LIMITS.feedbackAnswer}
            onChange={(e) => {
              setText(e.target.value);
              setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errId : undefined}
            placeholder="Your answer"
            className={fieldClass(!!problem, 'w-full resize-y')}
          />
          {problem ? <p id={errId} role="alert" className="text-xs font-medium text-danger">{problem}</p> : null}
          <div>
            <Button size="sm" onClick={submit} loading={send.isPending} className="[@media(pointer:coarse)]:!min-h-11">Send answer</Button>
          </div>
        </div>
      )}
    </li>
  );
}
