import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { queueOnOffline, sendTaskMove } from './queries';
import { asyncStore } from '../adapters/async-storage';
import { isNetworkError } from '../lib/api-client';
import { hiddenProjectsKey, moveToStatus, readHiddenProjects, statusMovePlan, withStatus } from '../lib/all-board';
import { taskMovePayload, type MoveOutcome } from '../lib/board-writes';
import { allTasksCopyKey, withoutOldDone } from '../lib/offline-copy';
import { ALL_BOARD_KEY } from '../lib/realtime';
import { refresh } from '../lib/refresh';
import { moveRefreshes } from '../lib/task-cache';
import { refetchAfterMove } from '../lib/task-status';
import type { ApiColumn, ApiTask, ColumnCategory } from '../lib/types';

/**
 * The All projects board's data (4c): every project's tasks for one day (GET /tasks?boardDate
 * without a project: the projects the person can see), the projects left out, and moving a card to
 * a status in its own project.
 */

/**
 * One day of every project's tasks, kept offline per day among the board days (capped with them),
 * with this person's moves still waiting laid over it — so a card moved offline stays under its new
 * status (offline-reads).
 */
export function useAllProjectsTasks(boardDate: string) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: [...ALL_BOARD_KEY, boardDate],
    queryFn: ({ queryKey }) =>
      reads.readBoard(queryKey, allTasksCopyKey(boardDate), () => resources.tasks.list({ boardDate }), { slim: withoutOldDone(Date.now()) }),
  });
}

/**
 * The projects this person left out of the board (kept on this phone, per person), and whether
 * that has been read yet. Kept as the ones left out, so a new project shows.
 */
export function useHiddenProjects(): [Set<string>, (next: Set<string>) => void, boolean] {
  const userId = useUserId();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [read, setRead] = useState(false);
  useEffect(() => {
    let alive = true;
    const done = (ids: Set<string>) => {
      if (!alive) return;
      setHidden(ids);
      setRead(true);
    };
    if (!userId) {
      done(new Set());
      return;
    }
    asyncStore
      .getItem(hiddenProjectsKey(userId))
      .then((v) => done(readHiddenProjects(v)))
      .catch(() => done(new Set()));
    return () => {
      alive = false;
    };
  }, [userId]);
  const choose = useCallback(
    (next: Set<string>) => {
      setHidden(new Set(next));
      if (userId) void asyncStore.setItem(hiddenProjectsKey(userId), JSON.stringify([...next])).catch(() => {});
    },
    [userId],
  );
  return [hidden, choose, read];
}

export type StatusMoveOutcome =
  | MoveOutcome
  /** Already under that status: nothing to do. */
  | { kind: 'same' }
  /** Its project has no column of that kind: it stays, and says so (the website's notice). */
  | { kind: 'no-column'; message: string };

/** Its project's columns couldn't be read (no connection, and none kept on this phone). */
export const NO_COLUMNS_TEXT = 'Couldn’t load that project’s columns, so the task wasn’t moved. Check your connection and try again.';

/**
 * Move a card to a status (4c), as the website's drop on the All projects board: into its own
 * project's first shown column of that kind (statusMovePlan), through the task write path
 * (sendTaskMove — its lane, its version, kept on this phone when it gets no answer). It shows under
 * the new status at once; a refusal puts it back. The project's columns are read through their
 * offline copy, so a move works offline once that board was opened.
 */
export function useStatusMove(): (task: ApiTask, status: ColumnCategory, projectName: string | null) => Promise<StatusMoveOutcome | { kind: 'refused'; message: string }> {
  const services = useServices();
  const { resources, reads, queue, currentUserId } = services;
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: ({ task, columnId, status }: { task: ApiTask; columnId: string; status: ColumnCategory }) =>
      sendTaskMove(services, { id: task.id, columnId, projectId: task.projectId, category: status }),
    onMutate: async ({ task, columnId, status }) => {
      await qc.cancelQueries({ queryKey: [...ALL_BOARD_KEY] });
      await qc.cancelQueries({ queryKey: ['task', task.id], exact: true });
      const boards = qc.getQueriesData<ApiTask[]>({ queryKey: [...ALL_BOARD_KEY] });
      const detail = qc.getQueryData<ApiTask>(['task', task.id]);
      qc.setQueriesData<ApiTask[]>({ queryKey: [...ALL_BOARD_KEY] }, (list) => (Array.isArray(list) ? withStatus(list, task.id, columnId, status) : list));
      if (detail) qc.setQueryData<ApiTask>(['task', task.id], { ...detail, columnId, columnCategory: status });
      return { boards, detail };
    },
    onError: async (err, { task, columnId, status }, ctx) => {
      if (isNetworkError(err)) {
        // Kept on this phone by the write path (already, nearly always): the card stays where it was put.
        await queueOnOffline(queue, currentUserId(), err, 'task.move', taskMovePayload({ id: task.id, columnId, projectId: task.projectId, category: status }));
        return;
      }
      for (const [key, data] of ctx?.boards ?? []) qc.setQueryData(key, data);
      if (ctx?.detail) qc.setQueryData(['task', task.id], ctx.detail);
    },
    onSettled: (_d, err, { task }) => {
      // Offline the move is kept, and a reload would get no answer (the sync refreshes once it is sent).
      if (!refetchAfterMove(err)) return;
      refresh(qc, [{ queryKey: [...ALL_BOARD_KEY] }, ...moveRefreshes(task.id, task.projectId)]);
    },
  });
  const run = move.mutateAsync;
  return useCallback(
    async (task, status, projectName) => {
      let columns: ApiColumn[];
      try {
        columns = await qc.fetchQuery({
          queryKey: ['columns', task.projectId],
          queryFn: ({ queryKey }) => reads.read(queryKey, `columns.${task.projectId}`, () => resources.projects.columns(task.projectId)),
          staleTime: 60_000,
        });
      } catch {
        return { kind: 'refused', message: NO_COLUMNS_TEXT };
      }
      const plan = statusMovePlan(task, status, columns, projectName);
      if (plan.kind !== 'move') return plan;
      const { columnId } = plan;
      return moveToStatus(() => run({ task, columnId, status }), { id: task.id, columnId });
    },
    [qc, reads, resources, run],
  );
}
