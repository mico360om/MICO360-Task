import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { bulkApi, type BulkResult } from '../../api/bulk';
import type { ApiProject } from '../../api/projects';
import type { MergeResult } from '../../api/task-merge';
import { BIN_KEY } from '../../api/recycle-bin';
import { selectedSpoken, type BulkSelection, type SelRef } from '../../lib/bulk-selection';
import { bulkBarActions, type BulkBarActionId } from '../../lib/bulk-words';
import { bulkMoveAvailability } from '../../lib/task-move';
import { bulkMergeAvailability, invalidateMergeQueries } from '../../lib/task-merge';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { todayKey } from '../../lib/due-date';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { useOpenTask } from '../../lib/useOpenTask';
import { useAuthStore } from '../../stores/auth-store';
import { MoveTaskDialog, useMoveTargets } from '../MoveTaskDialog';
import { MergeTasksDialog } from '../MergeTasksDialog';
import { MergedToast } from '../task-merge/MergedToast';
import { UndoMergeDialog } from '../task-merge/UndoMergeDialog';
import { BulkBar } from './BulkBar';
import { BulkActionDialog, type BulkDialogType } from './BulkActionDialog';
import { BulkSummary } from './BulkSummary';

export interface BulkToolsProps {
  selection: BulkSelection;
  /** The tasks shown now (the filters and the day applied): the others selected are "hidden by filters". */
  visibleIds: readonly string[];
  /** The projects the page knows: whether the person runs a selected task's project (canManage). */
  projects: readonly ApiProject[];
  /** The people on a task now, when the page knows (Unassign's choices). */
  assignedOf?: (taskId: string) => { id: string; name: string }[] | undefined;
  /** Offer Merge (today's flow: 2–10 tasks of projects the person manages). */
  merge?: boolean;
  /** The bar is shown (default: whenever something is selected). The board shows it only in Select mode. */
  show?: boolean;
  /** A project's Archived tasks page: only Duplicate, Unarchive and Delete (review M10). */
  archivedView?: boolean;
}

/**
 * Everything a place with ticked tasks needs (owner, 10 Nov): the bulk bar at the foot of the window,
 * each action's confirmation (a dry run first), the move dialog for Project (applied as a bulk change),
 * Merge (today's), the summary with Undo afterwards — and the selection's count said to screen readers.
 * After a change every task view refreshes and the selection is cleared.
 */
export function BulkTools({ selection, visibleIds, projects, assignedOf, merge = false, show = true, archivedView = false }: BulkToolsProps) {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const timeZone = useCompanyTimeZone();
  const openTask = useOpenTask();
  const [open, setOpen] = useState<BulkBarActionId | null>(null);
  const [summary, setSummary] = useState<BulkResult | null>(null);
  // The selection a change was applied to: "Select the 2 skipped" brings them back as they were known.
  const [appliedTo, setAppliedTo] = useState<SelRef[]>([]);
  const [merged, setMerged] = useState<MergeResult | null>(null);
  const [undoingMerge, setUndoingMerge] = useState<string | null>(null);
  const [mergeNote, setMergeNote] = useState<string | null>(null);

  const count = selection.count;
  const hidden = selection.hiddenOf(visibleIds);
  const targets = useMoveTargets(count > 0);
  const managed = useMemo(() => projects.filter((p) => p.canManage).map((p) => p.id), [projects]);
  const mergeAvail = merge ? bulkMergeAvailability(selection.refs, targets) : null;
  const actions = bulkBarActions({
    count,
    projectIds: selection.projectIds,
    unknownProject: selection.refs.some((r) => !r.projectId),
    isAdmin,
    managedProjectIds: managed,
    move: { canMove: bulkMoveAvailability(targets).canMove, reason: bulkMoveAvailability(targets).reason },
    merge: mergeAvail,
    archivedView,
  });
  const ids = selection.refs.map((r) => r.id);
  // Unassign's choices: the people on the selected tasks now (as the page knows them).
  const assignedNow = new Map<string, { id: string; name: string }>();
  for (const id of open === 'unassign' ? ids : []) for (const a of assignedOf?.(id) ?? []) assignedNow.set(a.id, a);
  const assigned = [...assignedNow.values()];

  function applied(result: BulkResult) {
    setOpen(null);
    setAppliedTo(selection.refs);
    selection.clear();
    setSummary(result);
    void invalidateTaskQueries(qc);
    if (result.action === 'delete') void qc.invalidateQueries({ queryKey: BIN_KEY });
  }
  function refreshAfterUndo() {
    selection.clear();
    void invalidateTaskQueries(qc);
    void qc.invalidateQueries({ queryKey: BIN_KEY });
  }

  const bar = show && count > 0;
  // Said once something was selected: "No tasks selected" after it is cleared.
  const spokeBefore = useRef(false);
  if (bar) spokeBefore.current = true;
  return (
    <>
      {/* The count, said to screen readers as it changes. */}
      <div className="sr-only" aria-live="polite" data-bulk-count>
        {bar ? selectedSpoken(count, hidden) : spokeBefore.current ? 'No tasks selected' : ''}
      </div>
      {bar ? <div aria-hidden="true" className="h-20" /> : null}
      {bar || summary ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4">
          {summary ? (
            <BulkSummary
              key={summary.undo?.id ?? JSON.stringify(summary.changed.map((c) => c.id))}
              result={summary}
              onSelectSkipped={(skipped) => selection.replace(skipped, appliedTo)}
              onOpenTask={(id) => openTask(id)}
              onDismiss={() => setSummary(null)}
              onUndone={refreshAfterUndo}
              // The bar and the dialog it came from are gone: keyboard focus comes to the summary.
              autoFocus
            />
          ) : null}
          {bar ? (
            <BulkBar
              count={count}
              hidden={hidden}
              actions={actions}
              onAction={(id) => {
                setSummary(null);
                setOpen(id);
              }}
              onClear={selection.clear}
            />
          ) : null}
        </div>
      ) : null}

      {open && open !== 'project' && open !== 'merge' ? (
        <BulkActionDialog
          type={open as BulkDialogType}
          taskIds={ids}
          projectIds={selection.projectIds}
          assigned={assigned}
          today={todayKey(timeZone)}
          onClose={() => setOpen(null)}
          onApplied={applied}
        />
      ) : null}

      {open === 'project' ? (
        <MoveTaskDialog
          tasks={selection.refs.map((r) => ({ id: r.id, key: r.key ?? '', title: r.title ?? '', projectId: r.projectId }))}
          onClose={() => setOpen(null)}
          onApply={async (input) => {
            const result = await bulkApi(apiClient).run(ids, {
              type: 'project',
              projectId: input.projectId,
              ...(input.columnId ? { columnId: input.columnId } : {}),
              ...(input.assignees ? { assignees: input.assignees } : {}),
            });
            applied(result);
          }}
        />
      ) : null}

      {open === 'merge' ? (
        <MergeTasksDialog
          tasks={selection.refs.map((r) => ({ id: r.id, key: r.key ?? '', title: r.title ?? '', projectId: r.projectId }))}
          onClose={() => setOpen(null)}
          onMerged={(result) => {
            setOpen(null);
            selection.clear();
            setMerged(result);
            void invalidateMergeQueries(qc);
          }}
        />
      ) : null}
      {undoingMerge ? (
        <UndoMergeDialog
          mergeId={undoingMerge}
          onClose={() => setUndoingMerge(null)}
          onUndone={(result) => {
            setUndoingMerge(null);
            setMerged(null);
            setMergeNote(result.text);
            void invalidateMergeQueries(qc);
          }}
        />
      ) : null}
      {merged ? <MergedToast text={merged.text} onOpen={() => openTask(merged.mainTaskId)} onUndo={() => setUndoingMerge(merged.mergeId)} onDismiss={() => setMerged(null)} /> : null}
      {mergeNote && !merged ? <MergedToast text={mergeNote} onDismiss={() => setMergeNote(null)} /> : null}
    </>
  );
}
