import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { TaskFormDialog } from './task-form/TaskFormDialog';
import { useCurrentProjectId } from './CurrentProject';

export interface NewTaskModalProps {
  onClose: () => void;
  onCreated?: () => void;
  /** Lock the modal to one project (e.g. opened from a board) — shown, not changeable. */
  projectId?: string;
  /** Start with this due date ('YYYY-MM-DD') — e.g. the day chosen on the calendar. */
  defaultDueDate?: string;
}

/**
 * The "New task" form usable from anywhere (header, My Tasks, the calendar…): the task form in create
 * mode. It starts in the project the open page shows (see CurrentProject), else the one used last time.
 */
/** Lists a new task can appear in: My Tasks, task lists, boards, the calendar and the dashboard (1.23.38: the
 * top bar's New Task is the only one, so no page passes its own refresh any more). */
const TASK_LIST_KEY = /^(my-tasks|tasks|project-tasks|board|calendar|dashboard|workload|timeline|priorit)/;

/** Marks every list a new task may appear in as stale, so the open page shows it straight away. */
export function refreshTaskLists(qc: QueryClient): void {
  void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && TASK_LIST_KEY.test(q.queryKey[0]) });
}

export function NewTaskModal({ onClose, onCreated, projectId, defaultDueDate }: NewTaskModalProps) {
  const pageProjectId = useCurrentProjectId();
  const qc = useQueryClient();
  return (
    <TaskFormDialog
      onClose={onClose}
      onCreated={() => {
        refreshTaskLists(qc);
        onCreated?.();
      }}
      projectId={projectId}
      defaultProjectId={pageProjectId ?? undefined}
      defaultDueDate={defaultDueDate}
    />
  );
}
