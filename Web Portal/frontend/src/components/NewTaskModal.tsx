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
export function NewTaskModal({ onClose, onCreated, projectId, defaultDueDate }: NewTaskModalProps) {
  const pageProjectId = useCurrentProjectId();
  return <TaskFormDialog onClose={onClose} onCreated={() => onCreated?.()} projectId={projectId} defaultProjectId={pageProjectId ?? undefined} defaultDueDate={defaultDueDate} />;
}
