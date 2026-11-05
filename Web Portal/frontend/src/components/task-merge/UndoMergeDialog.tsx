import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { taskMergeApi, type UndoResult } from '../../api/task-merge';
import { ApiError } from '../../lib/api-client';
import { undoNotes } from '../../lib/task-merge';
import { ConfirmDialog } from '../ui/ConfirmDialog';

const failureText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : `${fallback} Check your connection and try again.`);

/**
 * "Undo this merge?": asks first, saying what comes back, what was deleted since (it can't come back)
 * and that the main task stays in its project — then gives each task back what came from it.
 */
export function UndoMergeDialog({ mergeId, onClose, onUndone }: { mergeId: string; onClose: () => void; onUndone: (result: UndoResult) => void }) {
  const previewQ = useQuery({ queryKey: ['merge-undo-preview', mergeId], queryFn: () => taskMergeApi(apiClient).undoPreview(mergeId), staleTime: 0 });
  const undo = useMutation({ mutationFn: () => taskMergeApi(apiClient).undo(mergeId), onSuccess: onUndone });
  const p = previewQ.data;
  const keys = p ? p.tasks.map((t) => t.key) : [];
  const words = keys.length === 1 ? keys[0] : keys.length > 1 ? `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}` : 'the merged tasks';
  const problem = previewQ.isError ? failureText(previewQ.error, 'Couldn’t check the merge.') : p && !p.canUndo ? p.reason : undo.isError ? failureText(undo.error, 'Couldn’t undo the merge.') : null;
  return (
    <ConfirmDialog
      title="Undo this merge?"
      confirmLabel="Undo merge"
      keepLabel="Keep merged"
      tone="primary"
      busy={undo.isPending}
      error={problem}
      onConfirm={() => {
        if (p?.canUndo && !undo.isPending) undo.mutate();
      }}
      onClose={onClose}
    >
      {p ? (
        <div className="flex flex-col gap-2">
          <p>
            {words} {keys.length === 1 ? 'becomes a separate task' : 'become separate tasks'} again, with {keys.length === 1 ? 'its' : 'their'} own number, comments, files, checklist and people as at the merge. Anything added to {p.mainKey} since stays on {p.mainKey}.
          </p>
          {undoNotes(p).map((line) => (
            <p key={line} className="text-warning">
              {line}
            </p>
          ))}
        </div>
      ) : (
        <p role="status">Checking the merge…</p>
      )}
    </ConfirmDialog>
  );
}
