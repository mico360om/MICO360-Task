/**
 * 1.23.1 Merge tasks: something added to a task that has since been merged (a comment typed on a panel
 * opened before the merge, an upload, a checklist item, following it, a contact) lands on the main task,
 * and the server's answer names it: `mergedInto`. The API calls that add pass that on here; the open task
 * panel listens, says where it went, and switches to the main task.
 */
export interface MergedInto {
  /** The main task's id, and its number. */
  taskId: string;
  key: string | null;
  /** The number of the merged task it was sent to. */
  fromKey: string;
}

type Listener = (m: MergedInto) => void;
const listeners = new Set<Listener>();

/** Hear about additions that went to a main task. Returns the way to stop. */
export function onMergedWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** An addition's whole answer: pass on its `mergedInto`, when it has one. */
export function noteMergedWrite(answer: unknown): void {
  const m = (answer as { mergedInto?: Partial<MergedInto> } | null)?.mergedInto;
  if (!m || typeof m.taskId !== 'string' || typeof m.fromKey !== 'string') return;
  const heard: MergedInto = { taskId: m.taskId, key: typeof m.key === 'string' ? m.key : null, fromKey: m.fromKey };
  for (const l of [...listeners]) l(heard);
}

/** "Added to MICO-12 (MICO-14 was merged into it)." */
export function addedToMainText(m: MergedInto): string {
  return m.key ? `Added to ${m.key} (${m.fromKey} was merged into it).` : `Added to the task ${m.fromKey} was merged into.`;
}
