import type { MovePreview, TaskMoveExtras, TaskMovePreview } from '../api/tasks';
import { moveChanges } from './task-move';

/**
 * 1.24: the Move dialog's "What will change" with the categories a task drops (its new project has none of
 * the same name) and the guests copied onto the new project's company list — on top of lib/task-move.ts's
 * lines (that file is the Android app's too, byte for byte), just before the last line ("… go with it/them").
 */
export function moveChangesWithExtras(preview: MovePreview, today: string, columnId?: string): string[] {
  const lines = moveChanges(preview, today, columnId);
  const movable = preview.tasks.filter((t) => t.canMove) as (TaskMovePreview & TaskMoveExtras)[];
  if (lines.length === 0 || movable.length === 0) return lines;
  const project = preview.project.name;
  const extra: string[] = [];
  if (movable.length === 1) {
    const t = movable[0]!;
    const dropped = t.categoriesDropped ?? [];
    if (dropped.length) extra.push(`${droppedText(dropped)} — ${project} has none of ${dropped.length === 1 ? 'that name' : 'those names'}.`);
    if ((t.guestsCopied ?? 0) > 0) extra.push(`Copies ${guestsCopiedText(t.guestsCopied!)}.`);
  } else {
    for (const t of movable) {
      const dropped = t.categoriesDropped ?? [];
      const copied = t.guestsCopied ?? 0;
      if (dropped.length && copied > 0) extra.push(`${t.key} ${lowerFirst(droppedText(dropped))}, and copies ${guestsCopiedText(copied)}.`);
      else if (dropped.length) extra.push(`${t.key} ${lowerFirst(droppedText(dropped))}.`);
      else if (copied > 0) extra.push(`${t.key} copies ${guestsCopiedText(copied)}.`);
    }
  }
  return [...lines.slice(0, -1), ...extra, lines[lines.length - 1]!];
}

/** "Drops categories: Electrical, HSE" / "Drops category: Civil". */
const droppedText = (names: string[]) => `Drops ${names.length === 1 ? 'category' : 'categories'}: ${names.join(', ')}`;
/** "2 guests to the new company’s list" (moved to another company's project, they are copied onto its list). */
const guestsCopiedText = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'} to the new company’s list`;
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
