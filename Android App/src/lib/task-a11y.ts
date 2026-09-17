import type { ApiTask, Priority } from './types';

/**
 * Accessibility label for a task row. Voices everything the row conveys visually — crucially the
 * priority, which is otherwise shown only as a color bar (invisible to screen readers and to
 * color-blind users). Pure (no RN imports) so it can be unit-tested.
 */
const PRIORITY_LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export function taskRowA11yLabel(task: ApiTask, due: string | null, done: boolean): string {
  return [
    task.key,
    `${PRIORITY_LABEL[task.priority]} priority`,
    task.title,
    due ? `due ${due}` : null,
    done ? 'done' : task.progress > 0 ? `${task.progress}% complete` : null,
  ]
    .filter(Boolean)
    .join(', ');
}
