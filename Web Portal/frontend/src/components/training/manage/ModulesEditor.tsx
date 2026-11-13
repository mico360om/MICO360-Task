import { useEffect, useId, useRef, useState } from 'react';
import { LIMITS, MODULE_LABELS, ROLE_KEYS, TRAINING_MODULES, type ManageCourse, type ManageModule, type ModuleInput, type RoleKey, type TrainingModule } from '../../../api/training';
import { TOUCH_SQUARE } from '../../../lib/touch';
import { stayOnEnter } from '../../../lib/enter-key';
import { ActionMenu } from '../../meeting/ActionMenu';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { fieldClass } from '../../ui/Field';
import { ModuleIcon } from '../ModuleIcon';
import { moduleKeyOf } from '../dashboard-rules';
import { FormRow, ManageDialog } from './ManageDialog';
import { Glyph, IconButton, Notice, ROLE_LABELS, SectionCard, count, problemText } from './manage-ui';
import { tc, useCourseCache, useManageOptions } from './manage-queries';

/** "Off — the old course was removed" (the built-in short course was removed before the change), else "Off". */
export const offWords = (m: Pick<ManageModule, 'offReason'>): string => (m.offReason === 'REMOVED' ? 'Off — the old course was removed' : 'Off');

/** A module as a choice in a list ("Reports (off)" when switched off). */
export const moduleChoice = (m: Pick<ManageModule, 'title' | 'enabled'>): string => (m.enabled ? m.title : `${m.title} (off)`);

/** The modules in their order. */
export const modulesInOrder = (c: Pick<ManageCourse, 'modules'>): ManageModule[] => [...c.modules].sort((a, b) => a.position - b.position);

/** Reports and Admin settings are for administrators whatever the groups (the same rule as the feature itself). */
const ADMIN_FEATURES: readonly TrainingModule[] = ['reports', 'admin'];

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

type Dialog =
  | { kind: 'add' }
  | { kind: 'rename'; module: ManageModule }
  | { kind: 'audience'; module: ManageModule }
  | { kind: 'remove'; module: ManageModule }
  | { kind: 'switchOff'; module: ManageModule };

/** Who sees the module is everyone the course is for ("All staff", or "Clients" in a clients' course): its lessons with no module reach nobody new. */
const forEveryone = (m: Pick<ManageModule, 'enabled' | 'visibility'>): boolean => m.enabled && (m.visibility === 'All staff' || m.visibility === 'Clients');

/** Words for switching a published course's module off: people who have done everything else finish now. */
export const switchOffWords = (certificate: boolean): string =>
  `Learners won’t see it or need it. Anyone who has done everything else finishes the course now${certificate ? ' and gets the certificate' : ''}.`;

/**
 * The course's modules (any course: D6, 13 Nov): add, rename, move up or down, choose who sees each one (the same
 * choices as a course: the feature, staff groups and companies — companies only in a clients' course), switch one
 * off or on, and remove one (asked first: its lessons move to a module chosen, or to no module; lessons are never
 * deleted). A course without modules is one plain list of lessons, as before.
 */
export function ModulesEditor({ course }: { course: ManageCourse }) {
  const cache = useCourseCache(course.id);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const modules = modulesInOrder(course);
  const lessonsIn = (id: string) => course.lessons.filter((l) => l.moduleId === id).length;

  // After a move, the moved module's button keeps the focus (the other one when it reached an end); after a removal,
  // Add module has it (the removed module's menu is gone).
  useEffect(() => {
    const key = focusNext.current;
    if (!key) return;
    const el = key === 'add' ? rootRef.current?.closest('section')?.querySelector<HTMLButtonElement>('[data-add-module]') : controls.current.get(key);
    if (el && !el.disabled) {
      el.focus();
      focusNext.current = null;
    }
  });

  const say = (ok: string | null, bad: string | null = null) => {
    setDone(ok);
    setProblem(bad);
  };

  async function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= modules.length || moving) return;
    const order = modules.map((m) => m.id);
    const [id] = order.splice(index, 1);
    order.splice(to, 0, id!);
    setMoving(true);
    say(null);
    focusNext.current = `${id}:${by < 0 ? (to === 0 ? 'down' : 'up') : to === modules.length - 1 ? 'up' : 'down'}`;
    try {
      cache.setCourse(await tc().reorderModules(course.id, order));
    } catch (err) {
      focusNext.current = null;
      say(null, `Couldn’t move the module. ${problemText(err)}`);
    } finally {
      setMoving(false);
    }
  }

  // A module whose switch request is running ignores another click (it would send a second toggle and flip the label back).
  const switching = useRef(new Set<string>());
  async function switchModule(m: ManageModule) {
    if (switching.current.has(m.id)) return;
    // 1.23.32: switching a published course's module off can finish people (and give certificates): asked first.
    if (m.enabled && course.status === 'PUBLISHED') {
      setDialog({ kind: 'switchOff', module: m });
      return;
    }
    switching.current.add(m.id);
    say(null);
    try {
      cache.setCourse(await tc().updateModule(m.id, { enabled: !m.enabled }));
      say(m.enabled ? `Switched “${m.title}” off: learners don’t see it and don’t need it.` : `Switched “${m.title}” on: the people it is for see it.`);
    } catch (err) {
      say(null, `Couldn’t switch the module ${m.enabled ? 'off' : 'on'}. ${problemText(err)}`);
    } finally {
      switching.current.delete(m.id);
    }
  }

  const keep = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) controls.current.set(key, el);
    else controls.current.delete(key);
  };

  return (
    <SectionCard
      id="tc-ed-modules"
      title="Modules"
      description={
        modules.length
          ? `${count(modules.length, 'module')}, in the order learners see them. Each is shown only to the people it is for.${modules.length >= LIMITS.modulesPerCourse ? ` A course has at most ${LIMITS.modulesPerCourse} modules.` : ''}`
          : undefined
      }
      actions={
        <Button data-add-module onClick={() => setDialog({ kind: 'add' })} disabled={modules.length >= LIMITS.modulesPerCourse} className="!min-h-[44px]">
          {Glyph.plus}
          Add module
        </Button>
      }
    >
      <div ref={rootRef} className="flex flex-col gap-3">
        {problem ? <Notice>{problem}</Notice> : null}
        {done ? <Notice tone="ok">{done}</Notice> : null}
        {modules.length === 0 ? (
          <p className="rounded-lg bg-ground px-3 py-3 text-sm text-ink-2">
            No modules. Without modules the course is one list of lessons. Add modules to split it into parts, each shown only to the people who can use that part of MICO360.
          </p>
        ) : (
          <ol aria-label="Modules" className="flex flex-col gap-2">
            {modules.map((m, i) => {
              const n = lessonsIn(m.id);
              const lessonWords = n ? count(n, 'lesson') : 'No lessons';
              return (
                <li key={m.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                  <span className="w-6 flex-none text-sm font-semibold text-ink-2" aria-hidden="true">{`${i + 1}.`}</span>
                  {/* The module's feature, as the learners see it (13 Nov new look). */}
                  <ModuleIcon moduleKey={moduleKeyOf(m)} size={18} className={m.enabled ? 'text-ink-2' : 'text-ink-3'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span data-module-title dir="auto" className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{m.title}</span>
                      {!m.enabled ? <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">{offWords(m)}</span> : null}
                    </div>
                    {/* Switched off, the server's words are the Off words already (shown above). */}
                    <p className="text-xs text-ink-2">{m.enabled ? `${m.visibility} · ${lessonWords}` : lessonWords}</p>
                  </div>
                  <div className="flex flex-none items-center">
                    <IconButton label={`Move the module “${m.title}” up`} disabled={i === 0 || moving} onClick={() => void move(i, -1)} buttonRef={keep(`${m.id}:up`)}>
                      {Glyph.up}
                    </IconButton>
                    <IconButton label={`Move the module “${m.title}” down`} disabled={i === modules.length - 1 || moving} onClick={() => void move(i, 1)} buttonRef={keep(`${m.id}:down`)}>
                      {Glyph.down}
                    </IconButton>
                    <ActionMenu
                      label={`More for the module “${m.title}”`}
                      className="flex-none"
                      buttonClassName={`grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH_SQUARE}`}
                      items={[
                        { label: 'Rename', onSelect: () => setDialog({ kind: 'rename', module: m }) },
                        { label: 'Who sees it', onSelect: () => setDialog({ kind: 'audience', module: m }) },
                        { label: m.enabled ? 'Switch off' : 'Switch on', onSelect: () => void switchModule(m) },
                        { label: 'Remove', danger: true, onSelect: () => setDialog({ kind: 'remove', module: m }) },
                      ]}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {dialog?.kind === 'add' || dialog?.kind === 'rename' ? (
        <ModuleTitleDialog
          courseId={course.id}
          module={dialog.kind === 'rename' ? dialog.module : null}
          onClose={() => setDialog(null)}
          onSaved={(next, words) => {
            cache.setCourse(next);
            say(words);
          }}
        />
      ) : null}
      {dialog?.kind === 'audience' ? (
        <ModuleAudienceDialog
          course={course}
          module={dialog.module}
          onClose={() => setDialog(null)}
          onSaved={(next) => {
            cache.setCourse(next);
            say(`Saved who sees “${dialog.module.title}”.`);
          }}
        />
      ) : null}
      {dialog?.kind === 'switchOff' ? (
        <SwitchOffDialog
          module={dialog.module}
          certificate={course.certificateOn}
          onClose={() => setDialog(null)}
          onSwitched={(next) => {
            cache.setCourse(next);
            say(`Switched “${dialog.module.title}” off: learners don’t see it and don’t need it.`);
          }}
        />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <RemoveModuleDialog
          module={dialog.module}
          others={modules.filter((m) => m.id !== dialog.module.id)}
          lessonCount={lessonsIn(dialog.module.id)}
          onClose={() => setDialog(null)}
          onRemoved={(next) => {
            focusNext.current = 'add';
            cache.setCourse(next);
            say(`Removed the module “${dialog.module.title}”.`);
          }}
        />
      ) : null}
    </SectionCard>
  );
}

/** "Add module" (a title; it goes last) or "Rename module". */
function ModuleTitleDialog({ courseId, module, onClose, onSaved }: { courseId: string; module: ManageModule | null; onClose: () => void; onSaved: (c: ManageCourse, words: string) => void }) {
  const ids = { title: useId(), err: useId() };
  const [title, setTitle] = useState(module?.title ?? '');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const t = title.trim();
    if (!t) return setTitleError('Give the module a title.');
    if (module && t === module.title) return onClose();
    setBusy(true);
    setError(null);
    try {
      const next = module ? await tc().updateModule(module.id, { title: t }) : await tc().addModule(courseId, { title: t });
      onSaved(next, module ? `Renamed the module “${t}”.` : `Added the module “${t}”. Choose who sees it and move lessons into it.`);
      onClose();
    } catch (err) {
      setError(`${module ? 'Couldn’t rename the module.' : 'Couldn’t add the module.'} ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ManageDialog title={module ? 'Rename module' : 'Add module'} eyebrow={module?.title} onClose={onClose} onSubmit={() => void save()} submitLabel={module ? 'Save' : 'Add module'} busy={busy}>
      {error ? <Notice>{error}</Notice> : null}
      <FormRow label="Title" htmlFor={ids.title} error={titleError} errorId={ids.err} hint={module ? undefined : 'It is added at the end; move it up or down after.'}>
        <input
          id={ids.title}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleError(null);
          }}
          onKeyDown={stayOnEnter}
          maxLength={LIMITS.moduleTitle}
          dir="auto"
          aria-required="true"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? ids.err : undefined}
          className={fieldClass(!!titleError, 'w-full')}
        />
      </FormRow>
    </ManageDialog>
  );
}

const checkRow = 'flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-ground [@media(pointer:coarse)]:!min-h-11';

/**
 * "Who sees it": a staff course's module follows a feature (people see it only if they can use that part of
 * MICO360), staff groups (All staff, or the groups ticked) and companies; a clients' course's module, companies
 * only (the feature and the groups don't apply to clients). Save sends only what changed.
 */
function ModuleAudienceDialog({ course, module, onClose, onSaved }: { course: ManageCourse; module: ManageModule; onClose: () => void; onSaved: (c: ManageCourse) => void }) {
  const ids = { feature: useId(), featureHint: useId() };
  const optionsQ = useManageOptions();
  const staff = course.audience === 'STAFF';
  const [moduleKey, setModuleKey] = useState<TrainingModule>(module.moduleKey);
  const [roleKeys, setRoleKeys] = useState<RoleKey[]>([...module.roleKeys]);
  const [companyIds, setCompanyIds] = useState<string[]>([...module.companyIds]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const features = TRAINING_MODULES.filter((k) => k !== 'portal' || k === module.moduleKey);
  const companies = optionsQ.data?.companies ?? [];

  const toggleRole = (r: RoleKey) => setRoleKeys((list) => ROLE_KEYS.filter((k) => (k === r ? !list.includes(k) : list.includes(k))));
  const toggleCompany = (id: string) =>
    setCompanyIds((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      // In the options' order (ids not offered any more stay at the end).
      return [...companies.map((c) => c.id).filter((x) => next.includes(x)), ...next.filter((x) => !companies.some((c) => c.id === x))];
    });

  async function save() {
    const patch: Partial<ModuleInput> = {};
    if (staff && moduleKey !== module.moduleKey) patch.moduleKey = moduleKey;
    if (staff && !sameSet(roleKeys, module.roleKeys)) patch.roleKeys = roleKeys;
    if (!sameSet(companyIds, module.companyIds)) patch.companyIds = companyIds;
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    setError(null);
    try {
      onSaved(await tc().updateModule(module.id, patch));
      onClose();
    } catch (err) {
      setError(`Couldn’t save who sees it. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ManageDialog title="Who sees it" eyebrow={module.title} onClose={onClose} onSubmit={() => void save()} submitLabel="Save" busy={busy}>
      {error ? <Notice>{error}</Notice> : null}
      <p className="text-sm text-ink-2">Training never gives anyone access: a module is shown only to people who can already use what it teaches.</p>
      {staff ? (
        <>
          <FormRow label="Feature" htmlFor={ids.feature} hint="People see the module only if they can use this part of MICO360." hintId={ids.featureHint}>
            <select id={ids.feature} value={moduleKey} onChange={(e) => setModuleKey(e.target.value as TrainingModule)} aria-describedby={ids.featureHint} className={fieldClass(false, 'w-full')}>
              {features.map((k) => <option key={k} value={k}>{MODULE_LABELS[k]}</option>)}
            </select>
          </FormRow>
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-sm font-semibold text-ink">Groups</legend>
            <p className="mb-2 text-xs text-ink-2">
              {ADMIN_FEATURES.includes(moduleKey)
                ? `${MODULE_LABELS[moduleKey]} is for administrators only, whatever is ticked here.`
                : 'All staff: everyone who can use the feature. Tick groups to show it to them only.'}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={checkRow}>
                <input type="checkbox" checked={roleKeys.length === 0} onChange={() => setRoleKeys([])} className="h-4 w-4 flex-none accent-brand" />
                All staff
              </label>
              {ROLE_KEYS.map((r) => (
                <label key={r} className={checkRow}>
                  <input type="checkbox" checked={roleKeys.includes(r)} onChange={() => toggleRole(r)} className="h-4 w-4 flex-none accent-brand" />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <p className="text-sm text-ink-2">A clients’ course: the feature and staff groups don’t apply, only the companies.</p>
      )}
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-sm font-semibold text-ink">Companies</legend>
        <p className="mb-2 text-xs text-ink-2">{staff ? 'None ticked: every company. Ticked: only their people.' : 'None ticked: every client of the course. Ticked: only clients of their projects.'}</p>
        {optionsQ.isError ? (
          <Notice>{`Couldn’t load the companies. ${problemText(optionsQ.error)}`}</Notice>
        ) : optionsQ.data ? (
          companies.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {companies.map((co) => (
                <label key={co.id} className={checkRow}>
                  <input type="checkbox" checked={companyIds.includes(co.id)} onChange={() => toggleCompany(co.id)} className="h-4 w-4 flex-none accent-brand" />
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
    </ManageDialog>
  );
}

/**
 * Switch off a published course's module (asked first, 1.23.32): learners no longer see it or need it, so anyone who
 * has done everything else finishes the course now (with the certificate when it gives one). A refusal stays here.
 */
function SwitchOffDialog({ module, certificate, onClose, onSwitched }: { module: ManageModule; certificate: boolean; onClose: () => void; onSwitched: (c: ManageCourse) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchOff() {
    setBusy(true);
    setError(null);
    try {
      const next = await tc().updateModule(module.id, { enabled: false });
      onClose();
      onSwitched(next);
    } catch (err) {
      setError(`Couldn’t switch the module off. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog title={`Switch off “${module.title}”?`} confirmLabel="Switch off" keepLabel="Keep it on" busy={busy} error={error} onConfirm={() => void switchOff()} onClose={onClose}>
      <p>{switchOffWords(certificate)}</p>
    </ConfirmDialog>
  );
}

/**
 * Remove a module (asked first): its lessons move to the module chosen, or to no module — never deleted. A module
 * limited to some people (or switched off) whose lessons would go to no module says one line more (1.23.32): lessons
 * with no module are shown to everyone who can see the course.
 */
function RemoveModuleDialog({ module, others, lessonCount, onClose, onRemoved }: { module: ManageModule; others: ManageModule[]; lessonCount: number; onClose: () => void; onRemoved: (c: ManageCourse) => void }) {
  const moveId = useId();
  const warnId = useId();
  const [moveTo, setMoveTo] = useState('');
  const widens = moveTo === '' && !forEveryone(module);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const next = await tc().removeModule(module.id, lessonCount > 0 ? moveTo || null : null);
      onClose();
      onRemoved(next);
    } catch (err) {
      setError(`Couldn’t remove it. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog title={`Remove the module “${module.title}”?`} confirmLabel="Remove module" busy={busy} error={error} onConfirm={() => void remove()} onClose={onClose}>
      {lessonCount > 0 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={moveId} className="font-semibold text-ink">{`Move its ${count(lessonCount, 'lesson')} to`}</label>
          <select id={moveId} value={moveTo} onChange={(e) => setMoveTo(e.target.value)} disabled={busy} aria-describedby={widens ? warnId : undefined} className={fieldClass(false, 'w-full')}>
            <option value="">No module</option>
            {others.map((m) => <option key={m.id} value={m.id}>{moduleChoice(m)}</option>)}
          </select>
          {widens ? (
            <p id={warnId} className="font-semibold text-warning">
              Lessons with no module are shown to everyone who can see the course.
            </p>
          ) : null}
          <p className="mt-1">Lessons are never deleted. People keep their progress on them.</p>
        </div>
      ) : (
        <p>It has no lessons.</p>
      )}
    </ConfirmDialog>
  );
}
