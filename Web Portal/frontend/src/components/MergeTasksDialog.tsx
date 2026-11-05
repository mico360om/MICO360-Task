import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { taskSearchApi } from '../api/search';
import { taskMergeApi, type MergeChoices, type MergeDifference, type MergePreviewTask, type MergeResult, type PersonChoice } from '../api/task-merge';
import { ApiError } from '../lib/api-client';
import { countsLine, MAX_MERGE_TASKS } from '../lib/task-merge';
import { useDialog } from '../hooks/useDialog';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ModalPortal } from './ui/ModalPortal';
import { Button } from './ui/Button';
import { dialogLayer, dialogPanel } from './ui/dialog-size';
import { ComboPicker } from './task-drawer/combo-picker';
import { useMoveTargets } from './MoveTaskDialog';
import { TaskKey } from './TaskKey';

/** A task to merge, as the place it is merged from knows it. */
export interface MergeTaskRef {
  id: string;
  key: string;
  title: string;
  projectId: string;
}

export interface MergeTasksDialogProps {
  /** The tasks to start with: this task (the task panel), or the selection (My Tasks). */
  tasks: MergeTaskRef[];
  onClose: () => void;
  /** Merged: what happened (the caller closes the dialog and offers Open and Undo). */
  onMerged: (result: MergeResult) => void;
  /** Opened over the task panel (its own layer above it). */
  onTop?: boolean;
}

const failureText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : `${fallback} Check your connection and try again.`);
const radioClass = 'h-4 w-4 flex-none accent-brand';
const optionRow = 'flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 text-sm text-ink hover:bg-ground sm:min-h-0';

/**
 * "Merge tasks": choose the tasks (this one, plus any found by title or number), which one stays (the
 * main task: the oldest unless another is chosen), whose value to keep where they differ, and what
 * happens to people not on the main task's project team — then see what will be combined and what is
 * kept once before merging. Nothing is lost: the other tasks become read-only records of the main one,
 * and the merge can be undone from its "Merged from" panel.
 */
export function MergeTasksDialog({ tasks: initial, onClose, onMerged, onTop = false }: MergeTasksDialogProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const subtitleId = `${uid}-subtitle`;
  const [chosen, setChosen] = useState<MergeTaskRef[]>(() => initial.slice(0, MAX_MERGE_TASKS));
  const [mainId, setMainId] = useState<string | undefined>(undefined);
  const [choices, setChoices] = useState<MergeChoices>({});
  const [people, setPeople] = useState<Record<string, PersonChoice>>({});
  const [peopleError, setPeopleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const firstPerson = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const dialogRef = useDialog(() => {
    if (!busyRef.current) onClose();
  });

  const ids = useMemo(() => chosen.map((t) => t.id), [chosen]);
  // The project choice decides who isn't on the team and the new number: the preview is asked with it
  // (only while that task is still in the merge).
  const projectChoice = choices.project && ids.includes(choices.project) ? choices.project : undefined;
  const previewQ = useQuery({
    queryKey: ['merge-preview', ids, mainId ?? null, projectChoice ?? null],
    queryFn: () => taskMergeApi(apiClient).preview({ taskIds: ids, ...(mainId ? { mainTaskId: mainId } : {}), ...(projectChoice ? { choices: { project: projectChoice } } : {}) }),
    enabled: ids.length > 0,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const preview = previewQ.data;
  const main = preview?.mainTaskId ?? null;
  const usable = preview?.tasks.filter((t) => t.canMerge) ?? [];
  const refused = preview?.tasks.filter((t) => !t.canMerge) ?? [];
  const differences = preview?.differences ?? [];
  const outsiders = preview?.outsiders ?? [];

  // Choices for fields that no longer differ (or tasks no longer chosen) are dropped.
  const valid = (d: MergeDifference, value: string | undefined) => value !== undefined && d.options.some((o) => o.value === value);
  const choiceOf = (d: MergeDifference) => (valid(d, choices[d.field]) ? choices[d.field]! : (d.options.find((o) => o.value === main)?.value ?? d.options[0]!.value));

  // The task picker: tasks found by title or number, in projects the person may merge from.
  const targets = useMoveTargets();
  const searchFor = useDebouncedValue(query.trim(), 250);
  const searchQ = useQuery({
    queryKey: ['merge-picker', searchFor],
    queryFn: () => taskSearchApi(apiClient).search({ q: searchFor }),
    enabled: searchFor.length >= 1 && chosen.length < MAX_MERGE_TASKS,
    staleTime: 30_000,
  });
  const found = (searchQ.data?.data ?? []).filter(
    (h) => !ids.includes(h.id) && !h.project?.archived && (!targets || targets.managesAll || targets.managedProjectIds.includes(h.projectId)),
  );

  const merge = useMutation({
    mutationFn: () => {
      const keep: MergeChoices = {};
      for (const d of differences) keep[d.field] = choiceOf(d);
      const versions = Object.fromEntries(usable.map((t) => [t.id, t.version]));
      return taskMergeApi(apiClient).merge({ taskIds: usable.map((t) => t.id), mainTaskId: main!, choices: keep, people, versions });
    },
    onSuccess: (result) => onMerged(result),
    onError: (e) => {
      setError(failureText(e, 'Couldn’t merge the tasks.'));
      // Something changed since the preview (a task, a team): read it again.
      void previewQ.refetch();
    },
  });
  const busy = merge.isPending;
  busyRef.current = busy;

  useEffect(() => {
    setPeopleError(false);
  }, [preview?.outsiders.length]);

  function add(id: string) {
    const hit = found.find((h) => h.id === id);
    if (!hit || chosen.length >= MAX_MERGE_TASKS) return;
    setChosen((c) => [...c, { id: hit.id, key: hit.key, title: hit.title, projectId: hit.projectId }]);
    setQuery('');
    setError(null);
  }
  function remove(id: string) {
    setChosen((c) => c.filter((t) => t.id !== id));
    if (mainId === id) setMainId(undefined);
    setError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview || !preview.canMerge || !main || usable.length < 2 || busy) return;
    if (outsiders.some((o) => !people[o.id])) {
      setPeopleError(true);
      firstPerson.current?.focus();
      return;
    }
    setError(null);
    merge.mutate();
  }

  const mainTask = usable.find((t) => t.id === main);
  const projectName = preview?.project?.name ?? '';
  const footerButton = '!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50';

  return (
    <ModalPortal>
      <div className={dialogLayer('form', { onTop })}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitleId}
          className={`keyboard-flow-cramped card relative flex ${dialogPanel('form')} animate-scale-in flex-col overflow-hidden`}
        >
          <form onSubmit={submit} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
              <div>
                <h2 id={titleId} className="font-display text-xl font-bold text-ink">
                  Merge tasks
                </h2>
                <p id={subtitleId} className="mt-1 text-sm text-ink-2">
                  Combine them into one task. Nothing is lost: the others become records of it, their numbers still open it, and you can undo it later.
                </p>
              </div>
              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}

              <fieldset className="flex flex-col gap-2">
                <legend className="eyebrow mb-1">Main task — the one that stays</legend>
                <ul className="flex flex-col gap-1">
                  {(preview?.tasks ?? chosen.map((t) => ({ ...t, canMerge: true, reason: null, projectName: '', status: { name: '', category: '' } }) as unknown as MergePreviewTask)).map((t) => (
                    <li key={t.id} className="flex items-start gap-2 rounded-lg border border-line px-2 py-1.5">
                      {t.canMerge ? (
                        <label className={`${optionRow} min-w-0 flex-1`}>
                          <input type="radio" name={`${uid}-main`} value={t.id} checked={main === t.id} onChange={() => setMainId(t.id)} className={`${radioClass} mt-0.5`} aria-describedby={`${uid}-where-${t.id}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <TaskKey value={t.key} />
                              <span dir="auto" className="font-medium">
                                {t.title}
                              </span>
                            </span>
                            <span id={`${uid}-where-${t.id}`} className="mt-0.5 block text-xs text-ink-2">
                              {[t.projectName, t.status.name].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </label>
                      ) : (
                        <div className="min-w-0 flex-1 px-1 py-1.5 text-sm">
                          <span className="flex flex-wrap items-center gap-1.5 text-ink-2">
                            {t.key ? <TaskKey value={t.key} /> : null}
                            <span dir="auto">{t.key ? t.title : 'A task you can’t open'}</span>
                          </span>
                          <span className="mt-0.5 block text-xs font-medium text-warning">Can’t be merged: {t.reason}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        disabled={busy}
                        aria-label={`Take ${t.key || 'this task'} out of the merge`}
                        className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
                {chosen.length < MAX_MERGE_TASKS ? (
                  <ComboPicker
                    label="Add a task to merge"
                    inline
                    placeholder="Add a task — search by title or number…"
                    query={query}
                    onQuery={setQuery}
                    disabled={busy}
                    options={found.slice(0, 8).map((h) => ({ id: h.id, label: h.title, lead: <TaskKey value={h.key} />, trail: h.project?.name }))}
                    emptyText={searchFor ? (searchQ.isFetching ? 'Searching…' : 'No task you can merge matches.') : 'Type a title or a number.'}
                    onPick={add}
                  />
                ) : (
                  <p className="text-xs text-ink-2">At most {MAX_MERGE_TASKS} tasks can be merged at a time.</p>
                )}
              </fieldset>

              {previewQ.isLoading ? (
                <p role="status" className="text-sm text-ink-2">
                  Checking what will be combined…
                </p>
              ) : null}
              {previewQ.isError ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {failureText(previewQ.error, 'Couldn’t check what would be combined.')}
                </p>
              ) : null}
              {preview && preview.reason ? (
                <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  {preview.reason}
                </p>
              ) : null}

              {preview && preview.canMerge && mainTask ? (
                <>
                  {differences.length > 0 ? (
                    <section aria-labelledby={`${uid}-diff`} className="flex flex-col gap-3">
                      <div>
                        <h3 id={`${uid}-diff`} className="eyebrow">
                          Where they differ
                        </h3>
                        <p className="mt-0.5 text-xs text-ink-2">Each keeps the main task’s value unless you choose another.</p>
                      </div>
                      {differences.map((d) => (
                        <fieldset key={d.field} className="flex flex-col gap-0.5 rounded-lg border border-line p-2.5">
                          <legend className="px-1 text-sm font-medium text-ink">{d.label}</legend>
                          {d.options.map((o) => (
                            <label key={o.value} className={optionRow}>
                              <input
                                type="radio"
                                name={`${uid}-${d.field}`}
                                value={o.value}
                                checked={choiceOf(d) === o.value}
                                onChange={() => setChoices((c) => ({ ...c, [d.field]: o.value }))}
                                className={`${radioClass} mt-0.5`}
                              />
                              <span className="min-w-0">
                                <span dir="auto">{o.label}</span>{' '}
                                {o.keys.length ? <span className="ms-1 text-xs text-ink-3">· {o.keys.join(', ')}</span> : null}
                              </span>
                            </label>
                          ))}
                        </fieldset>
                      ))}
                    </section>
                  ) : null}

                  {preview.project?.changes ? (
                    <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
                      {mainTask.key} moves to {preview.project.name}
                      {preview.project.newKey ? ` and becomes ${preview.project.newKey}` : ''}; its number now still opens it.
                    </p>
                  ) : null}

                  {outsiders.length > 0 ? (
                    <section
                      aria-labelledby={`${uid}-people`}
                      aria-describedby={peopleError ? `${uid}-people-error` : undefined}
                      className={`flex flex-col gap-2 rounded-lg border p-3 ${peopleError ? 'border-danger ring-2 ring-danger/30' : 'border-line'}`}
                    >
                      <h3 id={`${uid}-people`} className="text-sm font-medium text-ink">
                        Not on the {projectName} team
                      </h3>
                      {outsiders.map((o, i) => (
                        <fieldset key={o.id} role="radiogroup" aria-required="true" className="flex flex-col gap-0.5">
                          <legend className="text-sm text-ink">
                            <span dir="auto" className="font-medium">
                              {o.name}
                            </span>{' '}
                            <span className="text-xs text-ink-3">({o.keys.join(', ')})</span>
                          </legend>
                          <label className={`${optionRow} ${o.canJoin ? '' : 'cursor-not-allowed opacity-60'}`}>
                            <input
                              ref={i === 0 ? firstPerson : undefined}
                              type="radio"
                              name={`${uid}-person-${o.id}`}
                              disabled={!o.canJoin}
                              checked={people[o.id] === 'ADD_TO_TEAM'}
                              onChange={() => {
                                setPeople((p) => ({ ...p, [o.id]: 'ADD_TO_TEAM' }));
                                setPeopleError(false);
                              }}
                              className={`${radioClass} mt-0.5`}
                            />
                            <span>{o.canJoin ? `Add to the ${projectName} team` : `Can’t join the ${projectName} team (another company)`}</span>
                          </label>
                          <label className={optionRow}>
                            <input
                              type="radio"
                              name={`${uid}-person-${o.id}`}
                              checked={people[o.id] === 'LEAVE_OFF'}
                              onChange={() => {
                                setPeople((p) => ({ ...p, [o.id]: 'LEAVE_OFF' }));
                                setPeopleError(false);
                              }}
                              className={`${radioClass} mt-0.5`}
                            />
                            <span>Leave off this task (noted in its history)</span>
                          </label>
                        </fieldset>
                      ))}
                      {peopleError ? (
                        <p id={`${uid}-people-error`} className="text-xs font-medium text-danger">
                          Choose for each person whether to add them to the team or leave them off.
                        </p>
                      ) : null}
                    </section>
                  ) : null}

                  <section aria-labelledby={`${uid}-combined`} className="flex flex-col gap-1.5">
                    <h3 id={`${uid}-combined`} className="eyebrow">
                      What will be combined into {mainTask.key}
                    </h3>
                    <ul className="flex flex-col gap-1 text-sm text-ink">
                      {usable.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-baseline gap-x-1.5">
                          <TaskKey value={t.key} />
                          <span className="text-ink-2">{t.id === main ? '(main) ' : ''}{countsLine(t.counts)}</span>
                        </li>
                      ))}
                    </ul>
                    {preview.duplicatesText ? <p className="text-sm text-ink-2">{preview.duplicatesText}</p> : null}
                    {preview.droppedLinks.filter((l) => l.reason === 'loop').map((l) => (
                      <p key={`${l.key}-${l.otherKey}`} className="text-sm text-warning">
                        The blocker link between {l.key} and {l.otherKey} would make a loop, so it isn’t carried over.
                      </p>
                    ))}
                    {preview.watchersLeftOff > 0 ? (
                      <p className="text-sm text-ink-2">
                        {preview.watchersLeftOff === 1 ? '1 watcher isn’t' : `${preview.watchersLeftOff} watchers aren’t`} on the {projectName} team and won’t follow the merged task.
                      </p>
                    ) : null}
                  </section>
                </>
              ) : null}

              {refused.length > 0 && usable.length >= 2 ? (
                <p className="text-xs text-ink-2">Tasks that can’t be merged are left out; take them out of the list or keep going without them.</p>
              ) : null}
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-line px-6 py-3">
              <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={onClose} disabled={busy} className={footerButton}>
                Cancel
              </button>
              <Button type="submit" loading={busy} disabled={!preview || !preview.canMerge || usable.length < 2 || previewQ.isFetching} className="!min-h-[44px] flex-[2]">
                {busy ? 'Merging…' : usable.length >= 2 ? `Merge ${usable.length} tasks` : 'Merge tasks'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
