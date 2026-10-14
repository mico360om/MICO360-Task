import { TaskFormDialog } from './task-form/TaskFormDialog';

export interface NewTaskModalProps {
  onClose: () => void;
  onCreated?: () => void;
  /** Lock the modal to one project (e.g. opened from a board) — shown, not changeable. */
  projectId?: string;
  /** Start with this due date ('YYYY-MM-DD') — e.g. the day chosen on the calendar. */
  defaultDueDate?: string;
}

/** The "New task" form usable from anywhere (header, My Tasks, the calendar…): the task form in create mode. */
export function NewTaskModal({ onClose, onCreated, projectId, defaultDueDate }: NewTaskModalProps) {
  return <TaskFormDialog onClose={onClose} onCreated={() => onCreated?.()} projectId={projectId} defaultDueDate={defaultDueDate} />;
}
