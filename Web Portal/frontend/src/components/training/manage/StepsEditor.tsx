import { useEffect, useId, useRef, useState } from 'react';
import { LIMITS, type ManageLesson, type StepInput } from '../../../api/training';
import { RichTextEditor } from '../../rich-text/RichTextEditor';
import { Button } from '../../ui/Button';
import { fieldClass } from '../../ui/Field';
import { stayOnEnter } from '../../../lib/enter-key';
import { Glyph, IconButton, Notice, TrainingPicture, problemText } from './manage-ui';
import { tc, useCourseCache } from './manage-queries';
import { draftKey } from './quiz-rules';
import { FilePickButton, PICTURE_TYPES, UploadProgress, useUpload } from './uploads';

interface StepDraft {
  key: string;
  title: string;
  body: string;
  imageFileId: string | null;
  imageAlt: string;
}

const stepsOf = (l: ManageLesson): StepDraft[] =>
  [...l.steps].sort((a, b) => a.position - b.position).map((s) => ({ key: draftKey(), title: s.title ?? '', body: s.body ?? '', imageFileId: s.image?.fileId ?? null, imageAlt: s.image?.alt ?? '' }));

const comparable = (steps: StepDraft[]) => JSON.stringify(steps.map(({ key: _key, ...rest }) => rest));

/** Why the steps can't be saved yet (a picture needs its words for people who can't see it), and which step; or null. */
export function stepsProblemAt(steps: readonly StepDraft[]): { message: string; index: number | null } | null {
  if (steps.length > LIMITS.stepsPerLesson) return { message: `A guide has at most ${LIMITS.stepsPerLesson} steps.`, index: null };
  for (const [i, s] of steps.entries()) {
    const at = (message: string) => ({ message, index: i });
    if (s.imageFileId && !s.imageAlt.trim()) return at(`Step ${i + 1}: describe its picture for people who can’t see it.`);
    if (s.imageAlt.length > LIMITS.imageAlt) return at(`Step ${i + 1}: keep the picture’s description to ${LIMITS.imageAlt} characters.`);
    if (s.title.length > LIMITS.stepTitle) return at(`Step ${i + 1}: keep the title to ${LIMITS.stepTitle} characters.`);
    if (!s.title.trim() && !s.body.trim() && !s.imageFileId) return at(`Step ${i + 1} is empty: give it a title, words or a picture, or remove it.`);
  }
  return null;
}

/** Why the steps can't be saved yet, or null. */
export const stepsProblem = (steps: readonly StepDraft[]): string | null => stepsProblemAt(steps)?.message ?? null;

/**
 * A step-by-step guide's steps: each a title, formatted words and a picture (with its description); move them up
 * or down, remove them, add more. One step is open at a time (12 Nov), the others folded to their titles; a new
 * step opens, and so does a step Save finds a problem in. "Save steps" saves the whole list at once.
 */
export function StepsEditor({ lesson, courseId }: { lesson: ManageLesson; courseId: string }) {
  const cache = useCourseCache(courseId);
  const [saved, setSaved] = useState(() => stepsOf(lesson));
  const [steps, setSteps] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(() => saved[0]?.key ?? null);
  const focusKey = useRef<string | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const dirty = comparable(steps) !== comparable(saved);

  useEffect(() => {
    if (!focusKey.current) return;
    const el = moveButtons.current.get(focusKey.current);
    if (el && !el.disabled) {
      el.focus();
      focusKey.current = null;
    }
  });

  const change = (key: string, patch: Partial<StepDraft>) => {
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setOk(false);
  };
  const move = (i: number, by: -1 | 1) => {
    const to = i + by;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(to, 0, s!);
    focusKey.current = `${s!.key}:${by < 0 ? (to === 0 ? 'down' : 'up') : to === next.length - 1 ? 'up' : 'down'}`;
    setSteps(next);
    setOk(false);
  };

  async function save() {
    const why = stepsProblemAt(steps);
    if (why) {
      if (why.index !== null) setOpenKey(steps[why.index]!.key);
      return setProblem(why.message);
    }
    setBusy(true);
    setProblem(null);
    const input: StepInput[] = steps.map((s) => ({ title: s.title.trim() || null, body: s.body || null, imageFileId: s.imageFileId, imageAlt: s.imageFileId ? s.imageAlt.trim() : null }));
    try {
      const next = await tc().saveSteps(lesson.id, input);
      setSaved(steps);
      setOk(true);
      cache.replaceLesson(next);
    } catch (err) {
      setProblem(`Couldn’t save the steps. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Steps</p>
        {dirty ? <span className="text-xs font-medium text-ink-2">Changes not saved yet</span> : null}
      </div>
      {steps.length === 0 ? <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">No steps yet. A guide needs at least one before the course can be published.</p> : null}
      <ol aria-label="Steps" className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <StepRow
            key={s.key}
            step={s}
            index={i}
            last={i === steps.length - 1}
            open={openKey === s.key}
            onOpen={() => setOpenKey(openKey === s.key ? null : s.key)}
            courseId={courseId}
            onChange={(p) => change(s.key, p)}
            onMove={(by) => move(i, by)}
            onRemove={() => {
              setSteps((list) => list.filter((x) => x.key !== s.key));
              setOk(false);
            }}
            moveRef={(dir, el) => {
              const k = `${s.key}:${dir}`;
              if (el) moveButtons.current.set(k, el);
              else moveButtons.current.delete(k);
            }}
          />
        ))}
      </ol>
      {problem ? <Notice>{problem}</Notice> : null}
      {ok && !dirty ? <Notice tone="ok">Steps saved.</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={steps.length >= LIMITS.stepsPerLesson}
          onClick={() => {
            const fresh = { key: draftKey(), title: '', body: '', imageFileId: null, imageAlt: '' };
            setSteps((list) => [...list, fresh]);
            setOpenKey(fresh.key);
            setOk(false);
          }}
          className="[@media(pointer:coarse)]:!min-h-11"
        >
          {Glyph.plus}
          Add step
        </Button>
        <Button type="button" size="sm" loading={busy} disabled={!dirty} onClick={() => void save()} className="[@media(pointer:coarse)]:!min-h-11">Save steps</Button>
      </div>
    </div>
  );
}

function StepRow({
  step,
  index,
  last,
  open,
  onOpen,
  courseId,
  onChange,
  onMove,
  onRemove,
  moveRef,
}: {
  step: StepDraft;
  index: number;
  last: boolean;
  open: boolean;
  onOpen: () => void;
  courseId: string;
  onChange: (p: Partial<StepDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  moveRef: (dir: 'up' | 'down', el: HTMLButtonElement | null) => void;
}) {
  const ids = { title: useId(), alt: useId(), altHint: useId(), body: useId() };
  const up = useUpload();
  const n = index + 1;
  async function pick(file: File) {
    const ref = await up.run(file, LIMITS.imageBytes, (onProgress) => tc().uploadFile(courseId, 'IMAGE', file, onProgress));
    if (ref) onChange({ imageFileId: ref.id });
  }
  return (
    <li className="rounded-xl border border-line p-3">
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="sr-only">{`Step ${n}`}</legend>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={ids.body}
            aria-label={`Step ${n}: ${step.title.trim() || 'no title yet'}`}
            onClick={onOpen}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-start text-sm hover:text-brand [@media(pointer:coarse)]:!min-h-11"
          >
            <span aria-hidden="true" className={`inline-block flex-none transition-transform ${open ? 'rotate-90' : 'rtl:-scale-x-100'}`}>›</span>
            <span className="flex-none font-bold text-ink">{`Step ${n}`}</span>
            {!open && step.title.trim() ? (
              <span dir="auto" className="min-w-0 truncate text-ink-2">
                {step.title}
              </span>
            ) : null}
          </button>
          <IconButton label={`Move step ${n} up`} disabled={index === 0} onClick={() => onMove(-1)} buttonRef={(el) => moveRef('up', el)}>{Glyph.up}</IconButton>
          <IconButton label={`Move step ${n} down`} disabled={last} onClick={() => onMove(1)} buttonRef={(el) => moveRef('down', el)}>{Glyph.down}</IconButton>
          <IconButton label={`Remove step ${n}`} tone="danger" onClick={onRemove}>{Glyph.trash}</IconButton>
        </div>
        {open ? (
          <div id={ids.body} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.title} className="text-sm font-semibold text-ink">{`Step ${n} title`}</label>
              <input id={ids.title} value={step.title} onChange={(e) => onChange({ title: e.target.value })} onKeyDown={stayOnEnter} maxLength={LIMITS.stepTitle} dir="auto" className={fieldClass(false, 'w-full')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">{`Step ${n} words`}</span>
              <RichTextEditor value={step.body} onChange={(html) => onChange({ body: html })} ariaLabel={`Step ${n} words`} placeholder="What to do, and what happens" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink">
                Picture<span className="font-normal text-ink-2"> (optional)</span>
              </span>
              {step.imageFileId ? (
                <>
                  <TrainingPicture fileId={step.imageFileId} alt={step.imageAlt || `Step ${n}`} className="max-h-56 w-auto max-w-full" />
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={ids.alt} className="text-sm font-semibold text-ink">{`Step ${n} picture description`}</label>
                    <input
                      id={ids.alt}
                      value={step.imageAlt}
                      onChange={(e) => onChange({ imageAlt: e.target.value })}
                      onKeyDown={stayOnEnter}
                      maxLength={LIMITS.imageAlt}
                      dir="auto"
                      aria-required="true"
                      aria-describedby={ids.altHint}
                      className={fieldClass(!step.imageAlt.trim(), 'w-full')}
                    />
                    <p id={ids.altHint} className="text-xs text-ink-2">Needed: what the picture shows, for people who can’t see it.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FilePickButton label="Replace picture" accept={PICTURE_TYPES} disabled={up.busy} onPick={(f) => void pick(f)} />
                    <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ imageFileId: null, imageAlt: '' })} className="[@media(pointer:coarse)]:!min-h-11">Remove picture</Button>
                  </div>
                </>
              ) : (
                <div>
                  <FilePickButton label={`Add a picture to step ${n}`} accept={PICTURE_TYPES} disabled={up.busy} onPick={(f) => void pick(f)} />
                </div>
              )}
              <UploadProgress progress={up.progress} />
              {up.problem ? <p role="alert" className="text-xs font-medium text-danger">{up.problem}</p> : null}
            </div>
          </div>
        ) : null}
      </fieldset>
    </li>
  );
}
