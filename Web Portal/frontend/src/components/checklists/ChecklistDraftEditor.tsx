import { useMemo, useRef } from 'react';
import { NestedChecklists, type ChecklistActions } from './NestedChecklists';
import {
  draftAdd,
  draftAddList,
  draftDuplicate,
  draftDuplicateList,
  draftMove,
  draftRemove,
  draftRemoveList,
  draftRename,
  draftRenameList,
  draftView,
  type ChecklistDraft,
} from '../../lib/checklist-tree';

/**
 * Checklists written before they exist — a new task's, a task template's, a project template's task's
 * (1.23.3): the task panel's editor (several checklists, nested items, the same keys), changing a local
 * draft the caller keeps and sends (`draftToTree`) with the rest. No ticks, people or dates here: those
 * are set once the task exists.
 */
export function ChecklistDraftEditor({ draft, onChange, disabled = false }: { draft: ChecklistDraft; onChange: (draft: ChecklistDraft) => void; disabled?: boolean }) {
  const view = useMemo(() => draftView(draft), [draft]);
  // Several changes can follow each other before the caller's state comes back: each builds on the last.
  const latest = useRef(draft);
  latest.current = draft;
  const apply = (next: ChecklistDraft) => {
    latest.current = next;
    onChange(next);
  };
  const actions: ChecklistActions = {
    addItem: (at, text) => {
      const r = draftAdd(latest.current, at, [text]);
      apply(r.draft);
      return r.ids[0];
    },
    addItems: (at, texts) => {
      const r = draftAdd(latest.current, at, texts);
      apply(r.draft);
      return r.ids;
    },
    rename: (id, text) => apply(draftRename(latest.current, id, text)),
    remove: (id) => apply(draftRemove(latest.current, id)),
    duplicate: (id) => apply(draftDuplicate(latest.current, id)),
    move: (id, how) => apply(draftMove(latest.current, id, how)),
    addList: (title, afterId) => {
      const r = draftAddList(latest.current, title, afterId);
      apply(r.draft);
      return r.id;
    },
    renameList: (id, title) => apply(draftRenameList(latest.current, id, title)),
    duplicateList: (id) => apply(draftDuplicateList(latest.current, id)),
    removeList: (id) => apply(draftRemoveList(latest.current, id)),
  };
  return <NestedChecklists lists={view.lists} items={view.items} actions={actions} mode="editor" disabled={disabled} typed={draft.typed} onTypedChange={(typed) => apply({ ...latest.current, typed })} />;
}
