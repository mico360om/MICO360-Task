import { useId, useState, type FormEvent } from 'react';
import { DIFFICULTIES, LIMITS, MODULE_LABELS, ROLE_KEYS, TRAINING_MODULES, type Audience, type CompletionRule, type CourseInput, type Difficulty, type ManageCourse, type RoleKey, type TargetOptions, type TrainingModule } from '../../../api/training';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';
import { fieldClass } from '../../ui/Field';
import { stayOnEnter } from '../../../lib/enter-key';
import { ChoiceGroup, FormRow } from './ManageDialog';
import { DIFFICULTY_LABELS, Notice, ROLE_LABELS, SectionCard, TrainingPicture, problemText } from './manage-ui';
import { tc, useCourseCache } from './manage-queries';
import { forcesClients } from './NewCourseDialog';
import { FilePickButton, PICTURE_TYPES, UploadProgress, useUpload } from './uploads';

interface Draft {
  title: string;
  summary: string;
  moduleKey: TrainingModule;
  audience: Audience;
  roleKeys: RoleKey[];
  difficulty: Difficulty;
  completionRule: CompletionRule;
  inOrder: boolean;
  certificateOn: boolean;
  certificateMonths: string;
  issuerUserId: string;
  issuerTitle: string;
  signatureFileId: string | null;
  companyIds: string[];
}

const draftOf = (c: ManageCourse): Draft => ({
  title: c.title,
  summary: c.summary ?? '',
  moduleKey: c.moduleKey,
  audience: c.audience,
  roleKeys: [...c.roleKeys],
  difficulty: c.difficulty,
  completionRule: c.completionRule,
  inOrder: c.inOrder,
  certificateOn: c.certificateOn,
  certificateMonths: c.certificateMonths === null ? '' : String(c.certificateMonths),
  issuerUserId: c.issuerUserId ?? '',
  issuerTitle: c.issuerTitle ?? '',
  signatureFileId: c.signature?.id ?? null,
  companyIds: [...c.companyIds],
});

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Only what changed, as PATCH /training/manage/courses/:id takes it. */
export function detailsPatch(c: ManageCourse, d: Draft): Partial<CourseInput> {
  const audience: Audience = forcesClients(d.moduleKey) ? 'CLIENTS' : d.audience;
  const roleKeys = audience === 'CLIENTS' ? [] : d.roleKeys;
  const months = d.certificateMonths.trim() ? Number(d.certificateMonths) : null;
  const p: Partial<CourseInput> = {};
  if (d.title.trim() !== c.title) p.title = d.title.trim();
  if ((d.summary.trim() || null) !== (c.summary ?? null)) p.summary = d.summary.trim() || null;
  if (d.moduleKey !== c.moduleKey) p.moduleKey = d.moduleKey;
  if (audience !== c.audience) p.audience = audience;
  if (!sameSet(roleKeys, c.roleKeys)) p.roleKeys = roleKeys;
  if (d.difficulty !== c.difficulty) p.difficulty = d.difficulty;
  if (d.completionRule !== c.completionRule) p.completionRule = d.completionRule;
  if (d.inOrder !== c.inOrder) p.inOrder = d.inOrder;
  if (d.certificateOn !== c.certificateOn) p.certificateOn = d.certificateOn;
  if (months !== c.certificateMonths) p.certificateMonths = months;
  if ((d.issuerUserId || null) !== c.issuerUserId) p.issuerUserId = d.issuerUserId || null;
  if ((d.issuerTitle.trim() || null) !== c.issuerTitle) p.issuerTitle = d.issuerTitle.trim() || null;
  if (d.signatureFileId !== (c.signature?.id ?? null)) p.signatureFileId = d.signatureFileId;
  if (!sameSet(d.companyIds, c.companyIds)) p.companyIds = d.companyIds;
  return p;
}

/** Why the details can't be saved yet (the server checks the same), or null. */
function detailsProblem(d: Draft): string | null {
  if (!d.title.trim()) return 'Give the course a title.';
  if (d.title.trim().length > LIMITS.courseTitle) return `Keep the title to ${LIMITS.courseTitle} characters.`;
  if (d.summary.length > LIMITS.courseSummary) return `Keep the summary to ${LIMITS.courseSummary.toLocaleString('en-US')} characters.`;
  if (d.certificateMonths.trim()) {
    const n = Number(d.certificateMonths);
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.certificateMonthsMax) return `A certificate is valid for 1 to ${LIMITS.certificateMonthsMax} months (blank: it never expires).`;
  }
  if (d.issuerTitle.trim().length > LIMITS.issuerTitle) return `Keep the signer’s title to ${LIMITS.issuerTitle} characters.`;
  return null;
}

/**
 * The course's details: title, summary, module, who it is for (staff roles, or clients), difficulty, how it is
 * completed, lessons in order, the certificate (valid months, Issued by, a signature picture) and the companies
 * it is limited to. Save sends only what changed; the server's words are shown when it refuses.
 */
export function CourseDetailsForm({ course, options }: { course: ManageCourse; options: TargetOptions | undefined }) {
  const cache = useCourseCache(course.id);
  const ids = { title: useId(), summary: useId(), summaryHint: useId(), module: useId(), difficulty: useId(), months: useId(), monthsHint: useId(), issuer: useId(), issuerTitle: useId(), inOrderHint: useId(), certHint: useId() };
  const [draft, setDraft] = useState<Draft>(() => draftOf(course));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const signature = useUpload();
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const audience: Audience = forcesClients(draft.moduleKey) ? 'CLIENTS' : draft.audience;
  const patch = detailsPatch(course, draft);
  const changed = Object.keys(patch).length > 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    const why = detailsProblem(draft);
    if (why) return setProblem(why);
    if (!changed) return;
    setBusy(true);
    setProblem(null);
    try {
      const next = await tc().updateCourse(course.id, patch);
      setDraft(draftOf(next));
      setSaved(true);
      cache.setCourse(next);
    } catch (err) {
      setProblem(`Couldn’t save the details. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pickSignature(file: File) {
    const ref = await signature.run(file, LIMITS.imageBytes, () => tc().uploadSignature(file));
    if (ref) set({ signatureFileId: ref.id });
  }

  const toggleIn = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <SectionCard id="tc-ed-details" title="Details">
      <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
        {problem ? <Notice>{problem}</Notice> : null}
        {saved ? <Notice tone="ok">Details saved.</Notice> : null}
        <FormRow label="Title" htmlFor={ids.title}>
          <input id={ids.title} value={draft.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={stayOnEnter} maxLength={LIMITS.courseTitle} dir="auto" aria-required="true" className={fieldClass(false, 'w-full')} />
        </FormRow>
        <FormRow label="Summary" htmlFor={ids.summary} optional hint={`${draft.summary.length.toLocaleString('en-US')}/${LIMITS.courseSummary.toLocaleString('en-US')} — what learners will be able to do.`} hintId={ids.summaryHint}>
          <textarea id={ids.summary} rows={3} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} maxLength={LIMITS.courseSummary} dir="auto" aria-describedby={ids.summaryHint} className={fieldClass(false, 'w-full resize-y')} />
        </FormRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Module" htmlFor={ids.module}>
            <select id={ids.module} value={draft.moduleKey} onChange={(e) => set({ moduleKey: e.target.value as TrainingModule })} className={fieldClass(false, 'w-full')}>
              {TRAINING_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
            </select>
          </FormRow>
          <FormRow label="Difficulty" htmlFor={ids.difficulty}>
            <select id={ids.difficulty} value={draft.difficulty} onChange={(e) => set({ difficulty: e.target.value as Difficulty })} className={fieldClass(false, 'w-full')}>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>)}
            </select>
          </FormRow>
        </div>
        <ChoiceGroup<Audience>
          legend="For"
          name={`${course.id}-audience`}
          value={audience}
          onChange={(a) => set({ audience: a })}
          options={[
            { value: 'STAFF', label: 'Staff', hint: 'Only staff who can use the module see it.', disabled: forcesClients(draft.moduleKey) },
            { value: 'CLIENTS', label: 'Clients', hint: 'Client accounts, in the Client portal. Never shown to staff as theirs.' },
          ]}
        />
        {audience === 'STAFF' ? (
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-sm font-semibold text-ink">Roles</legend>
            <p className="mb-2 text-xs text-ink-2">None ticked: everyone who can use the module.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_KEYS.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-ground [@media(pointer:coarse)]:!min-h-11">
                  <input type="checkbox" checked={draft.roleKeys.includes(r)} onChange={() => set({ roleKeys: toggleIn(draft.roleKeys, r) })} className="h-4 w-4 flex-none accent-brand" />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <ChoiceGroup<CompletionRule>
          legend="Completed when"
          name={`${course.id}-completion`}
          value={draft.completionRule}
          onChange={(r) => set({ completionRule: r })}
          options={[
            { value: 'ALL_LESSONS', label: 'All lessons are done', hint: 'A quiz counts when it is passed.' },
            { value: 'QUIZZES', label: 'The quizzes are passed', hint: 'Without a quiz: all lessons.' },
          ]}
        />
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Lessons in order</div>
            <div id={ids.inOrderHint} className="text-xs text-ink-2">A lesson opens only when the ones before it are done.</div>
          </div>
          <Toggle on={draft.inOrder} onChange={() => set({ inOrder: !draft.inOrder })} label="Lessons in order" describedBy={ids.inOrderHint} />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">Certificate</div>
              <div id={ids.certHint} className="text-xs text-ink-2">An A4 certificate with a code anyone can check, when the course is completed.</div>
            </div>
            <Toggle on={draft.certificateOn} onChange={() => set({ certificateOn: !draft.certificateOn })} label="Certificate" describedBy={ids.certHint} />
          </div>
          {draft.certificateOn ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Valid for (months)" htmlFor={ids.months} hint="Blank: it never expires. Before it does, people are reminded to take the course again." hintId={ids.monthsHint}>
                <input id={ids.months} type="number" inputMode="numeric" min={1} max={LIMITS.certificateMonthsMax} value={draft.certificateMonths} onChange={(e) => set({ certificateMonths: e.target.value })} onKeyDown={stayOnEnter} aria-describedby={ids.monthsHint} placeholder="Never expires" className={fieldClass(false, 'w-full')} />
              </FormRow>
              <FormRow label="Issued by" htmlFor={ids.issuer} optional>
                <select id={ids.issuer} value={draft.issuerUserId} onChange={(e) => set({ issuerUserId: e.target.value })} className={fieldClass(false, 'w-full')}>
                  <option value="">Nobody named</option>
                  {(options?.issuers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  {draft.issuerUserId && options && !options.issuers.some((p) => p.id === draft.issuerUserId) ? <option value={draft.issuerUserId}>Someone who can no longer sign</option> : null}
                </select>
              </FormRow>
              <FormRow label="Their title" htmlFor={ids.issuerTitle} optional hint="e.g. Training manager">
                <input id={ids.issuerTitle} value={draft.issuerTitle} onChange={(e) => set({ issuerTitle: e.target.value })} onKeyDown={stayOnEnter} maxLength={LIMITS.issuerTitle} dir="auto" className={fieldClass(false, 'w-full')} />
              </FormRow>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-semibold text-ink">
                  Signature picture<span className="font-normal text-ink-2"> (optional)</span>
                </span>
                {draft.signatureFileId ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <TrainingPicture fileId={draft.signatureFileId} alt="The signature on the certificate" className="h-16 w-40 bg-white" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => set({ signatureFileId: null })} className="[@media(pointer:coarse)]:!min-h-11">Remove signature</Button>
                  </div>
                ) : (
                  <FilePickButton label="Upload a signature" accept={PICTURE_TYPES} disabled={signature.busy} onPick={(f) => void pickSignature(f)} />
                )}
                <UploadProgress progress={signature.progress} />
                {signature.problem ? <p role="alert" className="text-xs font-medium text-danger">{signature.problem}</p> : null}
              </div>
            </div>
          ) : null}
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold text-ink">Companies</legend>
          <p className="mb-2 text-xs text-ink-2">None ticked: every company. Ticked: only their people (and clients of their projects).</p>
          {options ? (
            options.companies.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {options.companies.map((co) => (
                  <label key={co.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-ground [@media(pointer:coarse)]:!min-h-11">
                    <input type="checkbox" checked={draft.companyIds.includes(co.id)} onChange={() => set({ companyIds: toggleIn(draft.companyIds, co.id) })} className="h-4 w-4 flex-none accent-brand" />
                    <bdi className="min-w-0 [overflow-wrap:anywhere]">{co.name}</bdi>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-2">No companies.</p>
            )
          ) : (
            <div className="skeleton h-10 rounded-lg" aria-hidden="true" />
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy} disabled={!changed} className="!min-h-[44px]">Save details</Button>
          {!changed ? <span className="text-xs text-ink-2">No changes to save.</span> : null}
        </div>
      </form>
    </SectionCard>
  );
}
