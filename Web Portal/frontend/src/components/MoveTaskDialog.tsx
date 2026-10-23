import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { tasksApi, type AssigneeChoice, type BulkMoveResult, type MoveInput, type MoveResult, type MoveTargets } from '../api/tasks';
import { ApiError } from '../lib/api-client';
import { assigneeChoiceLabels, bulkMoveAvailability, bulkMovedText, moveAvailability, moveChanges, notOnTeamText } from '../lib/task-move';
import { statusMeta } from '../lib/taskStatus';
import { todayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { useDialog } from '../hooks/useDialog';
import { ModalPortal } from './ui/ModalPortal';
import { Button } from './ui/Button';
import { FieldLabel } from './ui/Field';
import { SearchableSelect } from './ui/SearchableSelect';
import { projectOption } from './project-option';

/** A task to move, as the place it is moved from knows it. */
export interface MoveTaskRef {
  id: string;
  key: string;
  title: string;
  projectId: string;
}

export interface MoveTaskDialogProps {
  /** One task (from its details panel or a board card), or several (My Tasks' selection). */
  tasks: MoveTaskRef[];
  onClose: () => void;
  /** One task moved: what happened (the caller closes the dialog and says so). */
  onMoved?: (result: MoveResult) => void;
  /**
   * Several tasks: what happened to each. When all moved the caller closes the dialog; otherwise the
   * dialog stays open listing the ones that couldn't be moved, until Done.
   */
  onBulkMoved?: (result: BulkMoveResult, projectName: string) => void;
}

/** Where the signed-in person may move tasks (shared with the menus that offer moving). */
export const MOVE_TARGETS_KEY = ['move-targets'] as const;

/**
 * Where the signed-in person may move tasks: undefined while it loads, null when it couldn't be
 * loaded (or came back in a shape it doesn't know). The menus offering "Move" and the dialog share it.
 */
export function useMoveTargets(enabled = true): MoveTargets | null | undefined {
  const q = useQuery({ queryKey: MOVE_TARGETS_KEY, queryFn: () => tasksApi(apiClient).moveTargets(), staleTime: 30_000, enabled });
  if (q.isError) return null;
  if (q.data === undefined) return undefined;
  return q.data && Array.isArray(q.data.projects) && Array.isArray(q.data.managedProjectIds) ? q.data : null;
}

const failureText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : `${fallback} Check your connection and try again.`);
const radioClass = 'h-4 w-4 flex-none accent-brand';

/**
 * "Move to another project": choose the project (only ones the person may move to: not this one, not
 * completed or archived), the column (the same kind of column as now, changeable), see what will
 * change, and answer for people assigned who aren't on the new team — that answer is required.
 * One dialog for one task or many.
 */
export function MoveTaskDialog({ tasks, onClose, onMoved, onBulkMoved }: MoveTaskDialogProps) {
  const single = tasks.length === 1;
  const ids = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const today = todayKey(useCompanyTimeZone());
  const [projectId, setProjectId] = useState('');
  // The column chosen; '' = the suggestion (one task) or each task's own kind of column (several).
  const [columnId, setColumnId] = useState('');
  const [choice, setChoice] = useState<AssigneeChoice | ''>('');
  const [choiceError, setChoiceError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkMoveResult | null>(null);
  const firstRadio = useRef<HTMLInputElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const subtitleId = `${uid}-subtitle`;
  const legendId = `${uid}-people`;
  const choiceErrorId = `${uid}-people-error`;
  const changesId = `${uid}-changes`;
  const refusedId = `${uid}-refused`;
  const columnHintId = `${uid}-column-hint`;

  const busyRef = useRef(false);
  const dialogRef = useDialog(() => {
    if (!busyRef.current) onClose();
  });

  const targets = useMoveTargets();
  // Its own project isn't offered (for several tasks, only when they are all in one project).
  const ownProject = tasks.every((t) => t.projectId === tasks[0]?.projectId) ? tasks[0]?.projectId : undefined;
  const projectOptions = useMemo(() => (targets?.projects ?? []).filter((p) => p.id !== ownProject).map(projectOption), [targets, ownProject]);
  const nowhere = targets !== undefined && projectOptions.length === 0;
  const nowhereReason = single ? moveAvailability(tasks[0]!.projectId, targets, undefined).reason : bulkMoveAvailability(targets).reason;

  const previewQ = useQuery({
    queryKey: ['move-preview', ids, projectId],
    queryFn: () => tasksApi(apiClient).movePreview(ids, projectId),
    enabled: Boolean(projectId),
    staleTime: 0,
  });
  const preview = projectId ? previewQ.data : undefined;
  const movable = preview?.tasks.filter((t) => t.canMove) ?? [];
  const refused = preview?.tasks.filter((t) => !t.canMove) ?? [];
  const outsiders = preview?.outsiders ?? [];
  const projectName = preview?.project.name ?? '';
  const columns = preview?.columns ?? [];
  const suggested = single ? (movable[0]?.columnId ?? '') : '';
  const chosenColumn = columnId || suggested;
  const changes = preview ? moveChanges(preview, today) : [];

  const moveOne = useMutation({
    mutationFn: (input: MoveInput) => tasksApi(apiClient).moveToProject(ids[0]!, input),
    onSuccess: (result) => onMoved?.(result),
    onError: (e) => setError(failureText(e, 'Couldn’t move the task.')),
  });
  const moveMany = useMutation({
    mutationFn: (input: MoveInput) => tasksApi(apiClient).moveManyToProject(movable.map((t) => t.id), input),
    onSuccess: (result) => {
      if (result.failed > 0) setOutcome(result);
      onBulkMoved?.(result, projectName);
    },
    onError: (e) => setError(failureText(e, 'Couldn’t move the tasks.')),
  });
  const busy = moveOne.isPending || moveMany.isPending;
  busyRef.current = busy;

  // The results replace the form (and its focused button): keep keyboard focus in the dialog.
  useEffect(() => {
    if (outcome) dialogRef.current?.querySelector<HTMLButtonElement>('[data-move-done]')?.focus();
  }, [outcome, dialogRef]);

  function chooseProject(next: string) {
    setProjectId(next);
    setColumnId('');
    setChoice('');
    setChoiceError(false);
    setError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview || movable.length === 0 || busy) return;
    if (outsiders.length > 0 && !choice) {
      setChoiceError(true);
      firstRadio.current?.focus();
      return;
    }
    setError(null);
    const input: MoveInput = {
      projectId,
      ...(chosenColumn ? { columnId: chosenColumn } : {}),
      ...(outsiders.length > 0 && choice ? { assignees: choice } : {}),
    };
    if (single) moveOne.mutate(input);
    else moveMany.mutate(input);
  }

  const title = single ? 'Move to another project' : `Move ${tasks.length} tasks to another project`;
  const subtitle = single ? (
    <>
      <span className="font-mono text-xs font-semibold text-ink-2">{tasks[0]!.key}</span>
      <span aria-hidden="true"> · </span>
      <span dir="auto">{tasks[0]!.title}</span>
    </>
  ) : (
    `${tasks.length} tasks selected`
  );
  const keyOf = (id: string) => {
    const t = preview?.tasks.find((x) => x.id === id) ?? tasks.find((x) => x.id === id);
    return t ? `${t.key || 'A task'} · ${t.title}` : 'A task';
  };

  // The suggested column is of another kind than the task's: the new project has none of its kind.
  const single0 = movable[0];
  const suggestedColumn = columns.find((c) => c.id === suggested);
  const columnHint = single
    ? single0 && suggestedColumn && !columnId && single0.currentCategory && suggestedColumn.category !== single0.currentCategory
      ? `${projectName} has no ${statusMeta(single0.currentCategory).label} column, so it goes to its first one.`
      : null
    : !columnId
      ? 'Each task goes to the same kind of column it’s in now, or the first one when there isn’t one.'
      : null;
  const columnOptions = [...(single ? [] : [{ value: '', label: 'Same kind of column as now' }]), ...columns.map((c) => ({ value: c.id, label: c.name, hint: statusMeta(c.category).label }))];
  const labels = assigneeChoiceLabels(outsiders);

  const footerButton = '!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50';
  const heading = (
    <div>
      <h2 id={titleId} className="font-display text-xl font-bold text-ink">
        {title}
      </h2>
      <p id={subtitleId} className="mt-1 text-sm text-ink-2">
        {subtitle}
      </p>
    </div>
  );

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitleId}
          className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height)-2rem)] w-full max-w-lg animate-scale-in flex-col overflow-hidden"
        >
          {outcome ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
                {heading}
                <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  {bulkMovedText(outcome, projectName)}
                </p>
                <ul aria-label="Couldn’t be moved" className="flex flex-col gap-1.5 text-sm text-ink">
                  {outcome.results.map((r) =>
                    r.ok ? null : (
                      <li key={r.taskId} dir="auto">
                        {`${keyOf(r.taskId)}: ${r.error.message}`}
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <div className="flex flex-none items-center gap-2 border-t border-line px-6 py-3">
                <Button data-move-done onClick={onClose} className="!min-h-[44px] flex-1">
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
              <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
                {heading}
                {error ? (
                  <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                ) : null}

                <div className="flex flex-col gap-1.5">
                  <FieldLabel required>Project</FieldLabel>
                  <SearchableSelect
                    ariaLabel="Project"
                    placeholder="Choose a project…"
                    options={projectOptions}
                    value={projectId}
                    onChange={chooseProject}
                    emptyText={targets === undefined ? 'Loading…' : 'No projects to move to'}
                  />
                  {nowhere ? <p className="text-xs text-ink-2">{nowhereReason}</p> : null}
                </div>

                {projectId && previewQ.isLoading ? (
                  <p role="status" className="text-sm text-ink-2">
                    Checking what will change…
                  </p>
                ) : null}
                {projectId && previewQ.isError ? (
                  <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                    {failureText(previewQ.error, 'Couldn’t check what would change.')}
                  </p>
                ) : null}

                {preview && single && refused[0] ? (
                  <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{refused[0].reason}</p>
                ) : null}

                {preview && movable.length > 0 ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel>Column</FieldLabel>
                      <SearchableSelect ariaLabel="Column" options={columnOptions} value={single ? chosenColumn : columnId} onChange={setColumnId} describedBy={columnHint ? columnHintId : undefined} />
                      {columnHint ? (
                        <p id={columnHintId} className="text-xs text-ink-2">
                          {columnHint}
                        </p>
                      ) : null}
                    </div>

                    {outsiders.length > 0 ? (
                      <fieldset
                        role="radiogroup"
                        aria-labelledby={legendId}
                        aria-required="true"
                        aria-invalid={choiceError ? 'true' : undefined}
                        aria-describedby={choiceError ? choiceErrorId : undefined}
                        className={`flex flex-col gap-2 rounded-lg border p-3 ${choiceError ? 'border-danger ring-2 ring-danger/30' : 'border-line'}`}
                      >
                        <legend id={legendId} className="px-1 text-sm font-medium text-ink">
                          {notOnTeamText(outsiders, projectName)}
                        </legend>
                        {(
                          [
                            ['ADD_TO_TEAM', labels.add],
                            ['UNASSIGN', labels.unassign],
                          ] as const
                        ).map(([value, label], i) => (
                          <label key={value} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm text-ink hover:bg-ground sm:min-h-0 sm:py-1">
                            <input
                              ref={i === 0 ? firstRadio : undefined}
                              type="radio"
                              name={`${uid}-choice`}
                              value={value}
                              checked={choice === value}
                              onChange={() => {
                                setChoice(value);
                                setChoiceError(false);
                              }}
                              className={radioClass}
                            />
                            <span dir="auto">{label}</span>
                          </label>
                        ))}
                        {choiceError ? (
                          <p id={choiceErrorId} className="text-xs font-medium text-danger">
                            Choose whether to add them to the team or unassign them.
                          </p>
                        ) : null}
                      </fieldset>
                    ) : null}

                    <section aria-labelledby={changesId} className="flex flex-col gap-1.5">
                      <h3 id={changesId} className="eyebrow">
                        What will change
                      </h3>
                      <ul aria-labelledby={changesId} className="flex list-disc flex-col gap-1 ps-5 text-sm text-ink">
                        {changes.map((line) => (
                          <li key={line} dir="auto">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </section>
                  </>
                ) : null}

                {preview && !single && refused.length > 0 ? (
                  <section aria-labelledby={refusedId} className="flex flex-col gap-1.5">
                    <h3 id={refusedId} className="eyebrow">
                      Can’t be moved
                    </h3>
                    <ul aria-labelledby={refusedId} className="flex flex-col gap-1 text-sm text-ink-2">
                      {refused.map((t) => (
                        <li key={t.id} dir="auto">
                          {`${keyOf(t.id)}: ${t.reason}`}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
              <div className="flex flex-none items-center gap-2 border-t border-line px-6 py-3">
                <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={onClose} disabled={busy} className={footerButton}>
                  Cancel
                </button>
                <Button type="submit" loading={busy} disabled={!preview || movable.length === 0} className="!min-h-[44px] flex-[2]">
                  {busy ? 'Moving…' : single ? 'Move task' : `Move ${movable.length || tasks.length} task${(movable.length || tasks.length) === 1 ? '' : 's'}`}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
