import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { owned } from './queries';
import { afterTaskMoved, afterTasksMoved } from '../lib/task-cache';
import { moveTargetsOf } from '../lib/move-sheet';
import type { BulkMoveResult, MoveInput, MoveResult, MoveTargets } from '../lib/types';

/** Where the signed-in person may move tasks (shared by the menus offering "Move" and the sheet). */
export const MOVE_TARGETS_KEY = ['move-targets'] as const;

/**
 * Where the signed-in person may move tasks (GET /tasks/move-targets): undefined while it loads, null
 * when it couldn't be loaded (or came back in a shape the app doesn't know) — the website's.
 */
export function useMoveTargets(enabled: boolean): MoveTargets | null | undefined {
  const { resources } = useServices();
  const q = useQuery({ queryKey: MOVE_TARGETS_KEY, queryFn: () => resources.tasks.moveTargets(), staleTime: 30_000, enabled });
  if (q.isError) return null;
  if (q.data === undefined) return undefined;
  return moveTargetsOf(q.data);
}

/** What moving these tasks to `projectId` would change (nothing is moved): read fresh each time. */
export function useMovePreview(taskIds: string[], projectId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['move-preview', taskIds, projectId],
    queryFn: () => resources.tasks.movePreview(taskIds, projectId),
    enabled: Boolean(projectId),
    staleTime: 0,
  });
}

/**
 * Moving to another project — online only, never kept on the phone: sent at once, as the person who
 * asked; every task that moved shows its new number at once and what it changed is read again.
 * Errors go back to the sheet, which says them.
 */
export function useMoveTasks(): { moveOne(id: string, input: MoveInput): Promise<MoveResult>; moveMany(ids: string[], input: MoveInput): Promise<BulkMoveResult> } {
  const services = useServices();
  const qc = useQueryClient();
  return useMemo(
    () => ({
      moveOne: (id, input) =>
        owned(services)
          .run((r) => r.tasks.moveToProject(id, input))
          .then((result) => {
            afterTaskMoved(qc, result);
            return result;
          }),
      moveMany: (ids, input) =>
        owned(services)
          .run((r) => r.tasks.bulkMoveToProject(ids, input))
          .then((result) => {
            afterTasksMoved(qc, result.results.flatMap((item) => (item.ok ? [item] : [])));
            return result;
          }),
    }),
    [services, qc],
  );
}
