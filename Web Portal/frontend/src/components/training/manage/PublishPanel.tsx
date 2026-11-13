import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS, type ManageCourse } from '../../../api/training';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { fieldClass } from '../../ui/Field';
import { stayOnEnter } from '../../../lib/enter-key';
import { ChoiceGroup, FormRow, ManageDialog } from './ManageDialog';
import { CourseStatusChip, Notice, SectionCard, errorCode, problemText } from './manage-ui';
import { MANAGE_KEY, tc, useCourseCache } from './manage-queries';

export type CourseAsk = 'unpublish' | 'archive' | 'delete';

/** The question before Unpublish, Archive or Delete (here and in the Manage list's ⋯ menu: the same words). */
export const ASK_WORDS: Readonly<Record<CourseAsk, { title: (courseTitle: string) => string; confirm: string; tone: 'danger' | 'primary'; body: string }>> = {
  unpublish: {
    title: (t) => `Unpublish “${t}”?`,
    confirm: 'Unpublish',
    tone: 'primary',
    body: 'It becomes a draft: learners can’t open it until you publish it again. Completions and certificates stay.',
  },
  archive: {
    title: (t) => `Archive “${t}”?`,
    confirm: 'Archive',
    tone: 'primary',
    body: 'It leaves All courses and can’t be assigned. Completions and certificates stay. Publish it again to bring it back.',
  },
  delete: {
    title: (t) => `Delete “${t}”?`,
    confirm: 'Delete course',
    tone: 'danger',
    body: 'The draft, its lessons and its files are deleted. This can’t be undone.',
  },
};

/** What Publish says for the course's state (null: nothing to publish). */
function publishLabel(c: ManageCourse): string | null {
  if (c.status === 'DRAFT') return c.publishedAt ? 'Publish again' : 'Publish';
  if (c.status === 'ARCHIVED') return 'Publish again';
  return c.unpublishedChanges ? 'Publish changes' : null;
}

/**
 * Publish, and the course's state: what stops it being published (a video lesson without its link…), Publish —
 * for a course published before, the author says whether it is a small fix (people keep their progress: completions
 * and certificates stay) or a big change (people who finished it review the changed lessons within N days) — Unpublish, Archive, and
 * Delete for a draft never published. `startPublishing` (the editor opened from the Manage list's "Publish changes" /
 * "Publish again"): the "What kind of change is this?" window opens at once when the course can be published.
 */
export function PublishPanel({ course, startPublishing = false }: { course: ManageCourse; startPublishing?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cache = useCourseCache(course.id);
  const problemsId = useId();
  const label = publishLabel(course);
  const refused = course.publishProblems.length > 0;
  const neverPublished = !course.publishedAt;
  const [asking, setAsking] = useState<CourseAsk | null>(null);
  const [choosing, setChoosing] = useState(() => startPublishing && !!label && !refused && !neverPublished);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function publish(change?: { change: 'MINOR' | 'MAJOR'; reviewDays?: number }) {
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const next = change ? await tc().publish(course.id, change) : await tc().publish(course.id);
      setChoosing(false);
      setDone(change ? `Published as version ${next.version}.` : 'Published. People can now find it, and you can assign it.');
      cache.setCourse(next);
    } catch (err) {
      if (errorCode(err) === 'CHANGE_KIND_NEEDED') setChoosing(true);
      else setProblem(`Couldn’t publish it. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(what: CourseAsk) {
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      if (what === 'delete') {
        await tc().deleteCourse(course.id);
        void qc.invalidateQueries({ queryKey: MANAGE_KEY });
        navigate('/training/manage', { replace: true });
        return;
      }
      const next = what === 'unpublish' ? await tc().unpublish(course.id) : await tc().archive(course.id);
      setDone(what === 'unpublish' ? 'Unpublished: it is a draft again.' : 'Archived.');
      setAsking(null);
      cache.setCourse(next);
    } catch (err) {
      setProblem(`${what === 'delete' ? 'Couldn’t delete it.' : what === 'archive' ? 'Couldn’t archive it.' : 'Couldn’t unpublish it.'} ${problemText(err)}`);
      setAsking(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard id="tc-ed-publish" title="Publish">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CourseStatusChip status={course.status} />
          {course.unpublishedChanges ? <Badge tone="info">Changes not published</Badge> : null}
          <span className="text-xs text-ink-2">{`Version ${course.version}`}</span>
        </div>
        <p className="text-sm text-ink-2">{`${course.enrolled.toLocaleString('en-US')} taking it · ${course.completed.toLocaleString('en-US')} finished`}</p>
        {done ? <Notice tone="ok">{done}</Notice> : null}
        {problem ? <Notice>{problem}</Notice> : null}
        {refused ? (
          <div id={problemsId} className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            <p className="font-semibold">It can’t be published yet:</p>
            <ul className="mt-1 list-disc ps-5">
              {course.publishProblems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ) : null}
        {course.status === 'PUBLISHED' && !course.unpublishedChanges && !done ? <p className="text-sm text-ink-2">Published. Lesson changes reach learners at once; publish them to say whether they were a minor fix or a major change.</p> : null}
        <div className="flex flex-wrap gap-2">
          {label ? (
            <Button
              onClick={() => (neverPublished ? void publish() : setChoosing(true))}
              loading={busy && !asking && !choosing}
              disabled={refused}
              aria-describedby={refused ? problemsId : undefined}
              className="!min-h-[44px]"
            >
              {label}
            </Button>
          ) : null}
          {course.status === 'PUBLISHED' ? (
            <Button variant="secondary" onClick={() => setAsking('unpublish')} className="!min-h-[44px]">Unpublish</Button>
          ) : null}
          {course.status !== 'ARCHIVED' ? (
            <Button variant="secondary" onClick={() => setAsking('archive')} className="!min-h-[44px]">Archive</Button>
          ) : null}
          {course.status === 'DRAFT' && neverPublished ? (
            <Button variant="secondary" onClick={() => setAsking('delete')} className="!min-h-[44px]">Delete</Button>
          ) : null}
        </div>
      </div>
      {choosing ? <ChangeKindDialog course={course} busy={busy} problem={problem} onPublish={(c) => void publish(c)} onClose={() => setChoosing(false)} /> : null}
      {asking ? (
        <ConfirmDialog
          title={ASK_WORDS[asking].title(course.title)}
          confirmLabel={ASK_WORDS[asking].confirm}
          tone={ASK_WORDS[asking].tone}
          busy={busy}
          onConfirm={() => void act(asking)}
          onClose={() => setAsking(null)}
        >
          {ASK_WORDS[asking].body}
        </ConfirmDialog>
      ) : null}
    </SectionCard>
  );
}

/** "What kind of change is this?" — a small fix or a big change (with the days to review in). */
function ChangeKindDialog({ course, busy, problem, onPublish, onClose }: { course: ManageCourse; busy: boolean; problem: string | null; onPublish: (c: { change: 'MINOR' | 'MAJOR'; reviewDays?: number }) => void; onClose: () => void }) {
  const ids = { days: useId(), err: useId() };
  const [kind, setKind] = useState<'MINOR' | 'MAJOR'>('MINOR');
  const [days, setDays] = useState('14');
  const [daysProblem, setDaysProblem] = useState<string | null>(null);
  const submit = () => {
    if (kind === 'MINOR') return onPublish({ change: 'MINOR' });
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.reviewDaysMax) return setDaysProblem(`Give 1 to ${LIMITS.reviewDaysMax} days.`);
    onPublish({ change: 'MAJOR', reviewDays: n });
  };
  return (
    <ManageDialog title="What kind of change is this?" eyebrow={course.title} onClose={onClose} onSubmit={submit} submitLabel="Publish" busy={busy}>
      {problem ? <Notice>{problem}</Notice> : null}
      <p className="text-sm text-ink-2">{`Learners already see your edits. Publishing makes this version ${course.version + 1} and says what it means for the ${course.completed.toLocaleString('en-US')} people who completed it.`}</p>
      <ChoiceGroup<'MINOR' | 'MAJOR'>
        legend="Change"
        name={`${course.id}-change`}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setDaysProblem(null);
        }}
        options={[
          { value: 'MINOR', label: 'Small fix — people keep their progress', hint: 'A typo or a clearer picture: completions and certificates stay as they are.' },
          { value: 'MAJOR', label: 'Big change — people take it again', hint: 'People who finished it go through the changed lessons again. Their certificates stay valid meanwhile.' },
        ]}
      />
      {kind === 'MAJOR' ? (
        <FormRow label="Review within (days)" htmlFor={ids.days} error={daysProblem} errorId={ids.err} hint="Each person’s review is due this many days from today.">
          <input id={ids.days} type="number" inputMode="numeric" min={1} max={LIMITS.reviewDaysMax} value={days} onChange={(e) => setDays(e.target.value)} onKeyDown={stayOnEnter} aria-invalid={daysProblem ? true : undefined} aria-describedby={daysProblem ? ids.err : undefined} className={fieldClass(!!daysProblem, 'w-full sm:w-40')} />
        </FormRow>
      ) : null}
    </ManageDialog>
  );
}
