export interface ChecklistItemRecord {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: number;
}

export interface ChecklistRepository {
  add(taskId: string, text: string, position: number): Promise<ChecklistItemRecord>;
  toggle(itemId: string, done: boolean): Promise<ChecklistItemRecord>;
  /** Edit an item's text. */
  editText(itemId: string, text: string): Promise<ChecklistItemRecord>;
  list(taskId: string): Promise<ChecklistItemRecord[]>;
  /** Set each listed item's position to its index in the array (reorder). */
  reorder(taskId: string, orderedIds: string[]): Promise<ChecklistItemRecord[]>;
  /** Remove an item, returning its task id (so callers can scope a broadcast). */
  remove(itemId: string): Promise<{ taskId: string } | null>;
}
