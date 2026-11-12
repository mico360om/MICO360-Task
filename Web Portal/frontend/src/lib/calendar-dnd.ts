/**
 * What is being dragged on the calendar (calendar scheduling): a task by its body or one of its ends
 * (▶ start, ⚑ due), a work block by its body or its end (resize), or a meeting. Carried in the drag's
 * data (and kept here while the drag lasts, since a page may only read the data on drop).
 */
export type DragPayload =
  /** `grabDay`: the day under the pointer when the drag started (a bar is moved by the days between). */
  | { kind: 'task'; id: string; grip: 'body' | 'start' | 'due'; grabDay: string }
  /** `grabOffset`: minutes from its start to the pointer (it keeps that place under the pointer). */
  | { kind: 'block'; id: string; grip: 'body' | 'end'; grabOffset: number }
  | { kind: 'meeting'; id: string; grabOffset: number };

export const DRAG_MIME = 'application/x-mico-calendar';
let current: DragPayload | null = null;

export function startDrag(e: { dataTransfer: DataTransfer | null }, payload: DragPayload): void {
  current = payload;
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  // Older drop targets (and other pages) read the task's id.
  e.dataTransfer.setData('text/plain', payload.kind === 'task' ? payload.id : '');
  e.dataTransfer.effectAllowed = 'move';
}

export function currentDrag(): DragPayload | null {
  return current;
}

export function endDrag(): void {
  current = null;
}

const isPayload = (v: unknown): v is DragPayload => {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (p.kind === 'task' || p.kind === 'block' || p.kind === 'meeting') && typeof p.id === 'string';
};

/** The payload a drop carries (a plain task id from an older chip moves that task by its body). */
export function readDrag(e: { dataTransfer: DataTransfer | null }): DragPayload | null {
  const raw = e.dataTransfer?.getData(DRAG_MIME);
  if (raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (isPayload(v)) return v;
    } catch {
      /* fall through */
    }
  }
  if (current) return current;
  const id = e.dataTransfer?.getData('text/plain');
  return id ? { kind: 'task', id, grip: 'body', grabDay: '' } : null;
}

/** The column (0-based) a pointer is over in a row of `count` equal columns (right to left in an RTL page). */
export function columnAt(clientX: number, rect: { left: number; width: number }, count: number, rtl = false): number {
  const col = Math.max(0, Math.min(count - 1, Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * count)));
  return rtl ? count - 1 - col : col;
}
