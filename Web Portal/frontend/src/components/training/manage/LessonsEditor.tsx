import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LESSON_KINDS, LIMITS, type LessonDeleteImpact, type LessonInput, type LessonKind, type ManageCourse, type ManageLesson } from '../../../api/training';
import { RichTextEditor } from '../../rich-text/RichTextEditor';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { fieldClass } from '../../ui/Field';
import { downloadBlob } from '../../../lib/download';
import { stayOnEnter } from '../../../lib/enter-key';
import { ChoiceGroup, FormRow, ManageDialog } from './ManageDialog';
import { Glyph, IconButton, LESSON_GLYPH, LESSON_KIND_LABELS, Notice, SectionCard, count, minutesText, problemText, sizeText } from './manage-ui';
import { tc, useCourseCache } from './manage-queries';
import { DOCUMENT_TYPES, FilePickButton, UploadProgress, useUpload } from './uploads';
import { StepsEditor } from './StepsEditor';
import { QuizEditor } from './QuizEditor';

const KIND_HINTS: Record<LessonKind, string> = {
  VIDEO: 'A YouTube or Vimeo link, played in the lesson.',
  GUIDE: 'Numbered steps, each with words and a picture.',
  DOCUMENT: 'A PDF, an Office file or a picture (up to 25 MB).',
  QUIZ: 'Questions marked automatically, with a pass mark.',
};

/** The lessons in order: open one to edit it, move it up or down, delete it, or add a lesson. */
export function LessonsEditor({ course }: { course: ManageCourse }) {
  const cache = useCourseCache(course.id);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ManageLesson | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef<string | null>(null);
  const lessons = [...course.lessons].sort((a, b) => a.position - b.position);

  // After a move, the moved lesson's button keeps the focus (the other one when it reached an end).
  useEffect(() => {
    if (!focusNext.current) return;
    const el = buttons.current.get(focusNext.current);
    if (el && !el.disabled) {
      el.focus();
      focusNext.current = null;
    }
  });

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= lessons.length || moving) return;
    const order = lessons.map((l) => l.id);
    const [id] = order.splice(index, 1);
    order.splice(to, 0, id!);
    setMoving(true);
    setProblem(null);
    focusNext.current = `${id}:${by < 0 ? (to === 0 ? 'down' : 'up') : to === lessons.length - 1 ? 'up' : 'down'}`;
    try {
      const next = await tc().reorderLessons(course.id, order);
      cache.setCourse(next);
    } catch (err) {
      focusNext.current = null;
      setProblem(`Couldn’t move the lesson. ${problemText(err)}`);
    } finally {
      setMoving(false);
    }
  }

  async function remove(l: ManageLesson) {
    setDeleteBusy(true);
    setDeleteProblem(null);
    try {
      await tc().deleteLesson(l.id);
      setDeleting(null);
      cache.refresh();
    } catch (err) {
      setDeleteProblem(`Couldn’t delete it. ${problemText(err)}`);
    } finally {
      setDeleteBusy(false);
    }
  }

  const total = lessons.reduce((s, l) => s + l.minutes, 0);
  return (
    <SectionCard
      id="tc-ed-lessons"
      title="Lessons"
      description={lessons.length ? `${count(lessons.length, 'lesson')} · about ${minutesText(total)}` : undefined}
      actions={
        <Button onClick={() => setAdding(true)} disabled={lessons.length >= LIMITS.lessonsPerCourse} className="!min-h-[44px]">
          {Glyph.plus}
          Add lesson
        </Button>
      }
    >
      {problem ? <div className="mb-3"><Notice>{problem}</Notice></div> : null}
      {lessons.length === 0 ? (
        <p className="rounded-lg bg-ground px-3 py-3 text-sm text-ink-2">No lessons yet. Add a video, a step-by-step guide, a document or a quiz.</p>
      ) : (
        <ol aria-label="Lessons" className="flex flex-col gap-2">
          {lessons.map((l, i) => {
            const isOpen = open.has(l.id);
            const panelId = `tc-lesson-${l.id}`;
            return (
              <li key={l.id} className="rounded-xl border border-line">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="w-6 flex-none text-sm font-semibold text-ink-2" aria-hidden="true">{`${i + 1}.`}</span>
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand/10 text-brand" aria-hidden="true">{LESSON_GLYPH[l.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(l.id)} className="block max-w-full text-left text-sm font-semibold text-ink [overflow-wrap:anywhere] hover:text-brand [@media(pointer:coarse)]:!min-h-11">
                      {l.title}
                    </button>
                    <p className="text-xs text-ink-2">
                      {`${LESSON_KIND_LABELS[l.kind]} · ${minutesText(l.minutes)}`}
                      {l.kind === 'VIDEO' && !l.video ? <span className="text-warning"> · Hidden from learners until it has its link</span> : null}
                    </p>
                  </div>
                  <div className="flex flex-none items-center">
                    <IconButton label={`Move “${l.title}” up`} disabled={i === 0 || moving} onClick={() => void move(i, -1)} buttonRef={(el) => keep(el, `${l.id}:up`)}>
                      {Glyph.up}
                    </IconButton>
                    <IconButton label={`Move “${l.title}” down`} disabled={i === lessons.length - 1 || moving} onClick={() => void move(i, 1)} buttonRef={(el) => keep(el, `${l.id}:down`)}>
                      {Glyph.down}
                    </IconButton>
                    <IconButton
                      label={`Delete “${l.title}”`}
                      tone="danger"
                      onClick={() => {
                        setDeleteProblem(null);
                        setDeleting(l);
                      }}
                    >
                      {Glyph.trash}
                    </IconButton>
                  </div>
                </div>
                {isOpen ? (
                  <div id={panelId} className="border-t border-line px-3 py-3">
                    <LessonEditor key={l.id} lesson={l} courseId={course.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {adding ? (
        <AddLessonDialog
          courseId={course.id}
          onClose={() => setAdding(false)}
          onAdded={(l) => {
            setOpen((s) => new Set([...s, l.id]));
            cache.refresh();
          }}
        />
      ) : null}
      {deleting && asksWhoFinishes(course, deleting) ? (
        <QuizDeleteDialog lesson={deleting} busy={deleteBusy} error={deleteProblem} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />
      ) : deleting ? (
        <ConfirmDialog
          title={`Delete the lesson “${deleting.title}”?`}
          confirmLabel="Delete lesson"
          busy={deleteBusy}
          error={deleteProblem}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        >
          Learners’ progress on it goes with it. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </SectionCard>
  );

  function keep(el: HTMLButtonElement | null, key: string) {
    if (el) buttons.current.set(key, el);
    else buttons.current.delete(key);
  }
}

/** Owner, 13 Nov (batch 4b): the quiz of a published course that gives a certificate. */
const asksWhoFinishes = (course: ManageCourse, l: ManageLesson) => l.kind === 'QUIZ' && course.status === 'PUBLISHED' && course.certificateOn;

/**
 * Deleting that quiz finishes everyone who has done every other lesson, with the certificate: the server works
 * out how many from everyone's progress now, and the administrator is asked first (Delete / Cancel). Delete
 * waits for the number; if it can't be worked out, the dialog says what may happen and still allows Delete.
 */
function QuizDeleteDialog({ lesson, busy, error, onConfirm, onClose }: { lesson: ManageLesson; busy: boolean; error: string | null; onConfirm: () => void; onClose: () => void }) {
  const [impact, setImpact] = useState<LessonDeleteImpact | 'unknown' | null>(null);
  useEffect(() => {
    let live = true;
    tc()
      .lessonDeleteImpact(lesson.id)
      .then(
        (r) => live && setImpact(r),
        () => live && setImpact('unknown'),
      );
    return () => {
      live = false;
    };
  }, [lesson.id]);
  let line: string;
  if (impact === null) line = 'Checking who this would finish…';
  else if (impact === 'unknown') line = 'Anyone who has done every other lesson will be marked finished and get the certificate.';
  else if (impact.finishing === 0) line = impact.certificate ? 'No one will be marked finished or get the certificate.' : 'No one will be marked finished.';
  else {
    const who = impact.finishing === 1 ? '1 person' : `${impact.finishing.toLocaleString('en-GB')} people`;
    line = impact.certificate ? `${who} will be marked finished and get the certificate.` : `${who} will be marked finished.`;
  }
  return (
    <ConfirmDialog title="Delete the quiz?" confirmLabel="Delete" keepLabel="Cancel" busy={busy} error={error} confirmDisabled={impact === null} onConfirm={onConfirm} onClose={onClose}>
      <p aria-live="polite" className="font-semibold text-ink">{line}</p>
      <p className="mt-1">{`“${lesson.title}” and learners’ answers to it go with it. This can’t be undone.`}</p>
    </ConfirmDialog>
  );
}

/** "Add lesson": its kind, title and minutes. */
function AddLessonDialog({ courseId, onClose, onAdded }: { courseId: string; onClose: () => void; onAdded: (l: ManageLesson) => void }) {
  const ids = { title: useId(), titleErr: useId(), minutes: useId() };
  const [kind, setKind] = useState<LessonKind>('GUIDE');
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    const t = title.trim();
    if (!t) return setTitleError('Give the lesson a title.');
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > LIMITS.minutesMax) return setError(`A lesson takes 1 to ${LIMITS.minutesMax} minutes.`);
    setBusy(true);
    setError(null);
    try {
      const l = await tc().addLesson(courseId, { kind, title: t, minutes: m });
      onAdded(l);
      onClose();
    } catch (err) {
      setError(`Couldn’t add the lesson. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ManageDialog title="Add lesson" onClose={onClose} onSubmit={() => void add()} submitLabel="Add lesson" busy={busy}>
      {error ? <Notice>{error}</Notice> : null}
      <ChoiceGroup<LessonKind> legend="Kind" name={`${courseId}-new-lesson-kind`} value={kind} onChange={setKind} options={LESSON_KINDS.map((k) => ({ value: k, label: LESSON_KIND_LABELS[k], hint: KIND_HINTS[k] }))} />
      <FormRow label="Title" htmlFor={ids.title} error={titleError} errorId={ids.titleErr}>
        <input
          id={ids.title}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleError(null);
          }}
          onKeyDown={stayOnEnter}
          maxLength={LIMITS.lessonTitle}
          dir="auto"
          aria-required="true"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? ids.titleErr : undefined}
          className={fieldClass(!!titleError, 'w-full')}
        />
      </FormRow>
      <FormRow label="Minutes" htmlFor={ids.minutes} hint="About how long it takes.">
        <input id={ids.minutes} type="number" inputMode="numeric" min={1} max={LIMITS.minutesMax} value={minutes} onChange={(e) => setMinutes(e.target.value)} onKeyDown={stayOnEnter} className={fieldClass(false, 'w-full sm:w-32')} />
      </FormRow>
    </ManageDialog>
  );
}

/** One lesson open for editing: its title, minutes and introduction (a video its link), then what its kind holds. */
function LessonEditor({ lesson, courseId }: { lesson: ManageLesson; courseId: string }) {
  const cache = useCourseCache(courseId);
  const ids = { title: useId(), minutes: useId(), link: useId(), linkHint: useId() };
  const start = { title: lesson.title, minutes: String(lesson.minutes), body: lesson.body ?? '', videoUrl: lesson.videoUrl ?? '' };
  const [saved, setSaved] = useState(start);
  const [draft, setDraft] = useState(start);
  const [problem, setProblem] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setOk(false);
  };

  const patch: Partial<LessonInput> = {};
  if (draft.title.trim() !== saved.title) patch.title = draft.title.trim();
  if (draft.minutes !== saved.minutes) patch.minutes = Number(draft.minutes);
  if ((draft.body || '') !== (saved.body || '')) patch.body = draft.body || null;
  if (lesson.kind === 'VIDEO' && draft.videoUrl.trim() !== saved.videoUrl) patch.videoUrl = draft.videoUrl.trim() || null;
  const changed = Object.keys(patch).length > 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return setProblem('Give the lesson a title.');
    const m = Number(draft.minutes);
    if (!Number.isInteger(m) || m < 1 || m > LIMITS.minutesMax) return setProblem(`A lesson takes 1 to ${LIMITS.minutesMax} minutes.`);
    if (!changed) return;
    setBusy(true);
    setProblem(null);
    try {
      const next = await tc().updateLesson(lesson.id, patch);
      // The introduction stays as typed (the server cleans it; the box isn't reset under the cursor).
      const now = { title: next.title, minutes: String(next.minutes), body: patch.body !== undefined ? (patch.body ?? '') : saved.body, videoUrl: next.videoUrl ?? '' };
      setSaved(now);
      setDraft((d) => ({ ...now, body: d.body }));
      setOk(true);
      cache.replaceLesson(next);
    } catch (err) {
      setProblem(`Couldn’t save the lesson. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-3" aria-label={`Lesson “${lesson.title}”`}>
        {problem ? <Notice>{problem}</Notice> : null}
        {ok ? <Notice tone="ok">Lesson saved.</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <FormRow label="Lesson title" htmlFor={ids.title}>
            <input id={ids.title} value={draft.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={stayOnEnter} maxLength={LIMITS.lessonTitle} dir="auto" className={fieldClass(false, 'w-full')} />
          </FormRow>
          <FormRow label="Minutes" htmlFor={ids.minutes}>
            <input id={ids.minutes} type="number" inputMode="numeric" min={1} max={LIMITS.minutesMax} value={draft.minutes} onChange={(e) => set({ minutes: e.target.value })} onKeyDown={stayOnEnter} className={fieldClass(false, 'w-full')} />
          </FormRow>
        </div>
        {lesson.kind === 'VIDEO' ? (
          <FormRow label="YouTube or Vimeo link" htmlFor={ids.link} hint="Unlisted videos are fine. The link is checked when you save." hintId={ids.linkHint}>
            <input id={ids.link} type="url" inputMode="url" value={draft.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} onKeyDown={stayOnEnter} maxLength={LIMITS.videoUrl} placeholder="https://www.youtube.com/watch?v=…" aria-describedby={ids.linkHint} className={fieldClass(false, 'w-full')} dir="ltr" />
          </FormRow>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">
            Introduction<span className="font-normal text-ink-2"> (optional)</span>
          </span>
          <RichTextEditor value={draft.body} onChange={(html) => set({ body: html })} ariaLabel="Introduction" placeholder="What this lesson covers" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" loading={busy} disabled={!changed} className="[@media(pointer:coarse)]:!min-h-11">Save lesson</Button>
          {!changed ? <span className="text-xs text-ink-2">No changes to save.</span> : null}
        </div>
      </form>
      {lesson.kind === 'VIDEO' ? <VideoPreview lesson={lesson} /> : null}
      {lesson.kind === 'GUIDE' ? <StepsEditor lesson={lesson} courseId={courseId} /> : null}
      {lesson.kind === 'DOCUMENT' ? <DocumentField lesson={lesson} courseId={courseId} /> : null}
      {lesson.kind === 'QUIZ' ? <QuizEditor lesson={lesson} courseId={courseId} /> : null}
    </div>
  );
}

/** The saved video, played as learners see it (the privacy player: youtube-nocookie or Vimeo). */
function VideoPreview({ lesson }: { lesson: ManageLesson }) {
  if (!lesson.video) return <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">No video yet: paste its link above and save. Learners see the lesson as soon as it has its link — nothing to publish.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">Preview</p>
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-ground">
        <iframe
          src={lesson.video.embedUrl}
          title={`Video preview: ${lesson.title}`}
          allow="encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          className="aspect-video w-full"
        />
      </div>
      <a href={lesson.video.watchUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:underline">
        {`Open it on ${lesson.video.provider === 'YOUTUBE' ? 'YouTube' : 'Vimeo'}`}
      </a>
    </div>
  );
}

/** A document lesson's file: upload (up to 25 MB, with progress), open, replace or remove. */
function DocumentField({ lesson, courseId }: { lesson: ManageLesson; courseId: string }) {
  const cache = useCourseCache(courseId);
  const up = useUpload();
  const [busy, setBusy] = useState(false);
  const doc = lesson.document;

  // The old file goes once the lesson no longer uses it (a download of the course is never touched).
  const dropOld = () => {
    if (doc && doc.kind === 'DOCUMENT') void tc().deleteFile(doc.id).catch(() => {});
  };

  async function pick(file: File) {
    const ref = await up.run(file, LIMITS.documentBytes, (onProgress) => tc().uploadFile(courseId, 'DOCUMENT', file, onProgress));
    if (!ref) return;
    setBusy(true);
    try {
      const next = await tc().updateLesson(lesson.id, { fileId: ref.id });
      dropOld();
      cache.replaceLesson(next);
    } catch (err) {
      void tc().deleteFile(ref.id).catch(() => {});
      up.fail(`Couldn’t attach “${file.name}”. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    up.clear();
    try {
      const next = await tc().updateLesson(lesson.id, { fileId: null });
      dropOld();
      cache.replaceLesson(next);
    } catch (err) {
      up.fail(`Couldn’t remove the document. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function open() {
    if (!doc) return;
    try {
      downloadBlob(doc.name, await tc().file(doc.id));
    } catch (err) {
      up.fail(`Couldn’t open the document. ${problemText(err)}`);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">Document</p>
      {doc ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
          <span className="text-ink-2" aria-hidden="true">{Glyph.document}</span>
          <div className="min-w-0 flex-[1_1_10rem]">
            <p dir="auto" className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{doc.name}</p>
            <p className="text-xs text-ink-2">{sizeText(doc.sizeBytes)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void open()} className="[@media(pointer:coarse)]:!min-h-11">Open</Button>
          <FilePickButton label="Replace" accept={DOCUMENT_TYPES} disabled={up.busy || busy} onPick={(f) => void pick(f)} />
          <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} disabled={up.busy || busy} className="[@media(pointer:coarse)]:!min-h-11">Remove</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <FilePickButton label="Upload a document" accept={DOCUMENT_TYPES} disabled={up.busy || busy} onPick={(f) => void pick(f)} variant="primary" />
          <span className="text-xs text-ink-2">PDF, Word, Excel, PowerPoint or a picture — up to 25 MB.</span>
        </div>
      )}
      <UploadProgress progress={up.progress} />
      {up.problem ? <p role="alert" className="text-xs font-medium text-danger">{up.problem}</p> : null}
    </div>
  );
}
