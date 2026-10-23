import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { owned, sendTaskEdit, sendTaskMove } from './queries';
import { asyncStore } from '../adapters/async-storage';
import { createBulkRefresher, doneColumnOf, runBulk, type BulkAction, type BulkDeps, type BulkResult, type BulkRunOptions, type BulkTaskRef } from '../lib/bulk-actions';
import { newIdempotencyKey } from '../lib/idempotency';
import { itemLanes, sendItemWrite } from '../lib/item-lanes';
import { readSavedViews, savedViewsKey, withSavedView, withoutView, type SavedView, type TaskFilters } from '../lib/my-tasks';
import { refresh } from '../lib/refresh';
import { afterTaskSaved, assignmentRefreshes, moveRefreshes } from '../lib/task-cache';
import type { ApiColumn } from '../lib/types';

/**
 * My Tasks' saved views and bulk actions (4d). Views are kept on this phone, per person (the
 * website keeps them in the browser). Bulk actions run one task at a time through each task's own
 * write path — as the website's, which reuses the single-task requests.
 */

/** Your own saved views, and saving or deleting one. */
export function useSavedViews(): { custom: SavedView[]; save: (name: string, filters: TaskFilters) => void; remove: (id: string) => void } {
  const userId = useUserId();
  const [custom, setCustom] = useState<SavedView[]>([]);
  useEffect(() => {
    let alive = true;
    setCustom([]);
    if (!userId) return;
    asyncStore
      .getItem(savedViewsKey(userId))
      .then((raw) => alive && setCustom(readSavedViews(raw)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);
  const keep = useCallback(
    (next: SavedView[]) => {
      setCustom(next);
      if (userId) void asyncStore.setItem(savedViewsKey(userId), JSON.stringify(next)).catch(() => {});
    },
    [userId],
  );
  const save = useCallback((name: string, filters: TaskFilters) => keep(withSavedView(custom, name, filters, () => `view:${newIdempotencyKey()}`)), [custom, keep]);
  const remove = useCallback((id: string) => keep(withoutView(custom, id)), [custom, keep]);
  return { custom, save, remove };
}

/**
 * Run one bulk action on the selected tasks: each change through that task's own write — an edit
 * (its version: the newer of the details' and the list's), a move (into the project's Done column
 * for Complete), an assignment — kept on this phone when it gets no answer. Each task's own data is
 * refreshed as it goes; My Tasks and every list, board, figure and calendar it touched are read
 * again once, at the end (final review A2). `opts`: how far it is, and a Stop.
 */
export function useBulkTaskActions(): (tasks: (BulkTaskRef & { version?: number })[], action: BulkAction, opts?: BulkRunOptions) => Promise<BulkResult> {
  const services = useServices();
  const qc = useQueryClient();
  return useCallback(
    async (tasks, action, opts) => {
      const refresher = createBulkRefresher((targets) => refresh(qc, targets));
      const versions = new Map(tasks.map((t) => [t.id, t.version]));
      const columns = new Map<string, Promise<ApiColumn[]>>();
      const columnsOf = (projectId: string): Promise<ApiColumn[]> => {
        let p = columns.get(projectId);
        if (!p) {
          p = qc.fetchQuery({
            queryKey: ['columns', projectId],
            queryFn: ({ queryKey }) => services.reads.read(queryKey, `columns.${projectId}`, () => services.resources.projects.columns(projectId)),
            staleTime: 60_000,
          });
          columns.set(projectId, p);
        }
        return p;
      };
      const deps: BulkDeps = {
        update: async (t, patch) => {
          const saved = await sendTaskEdit(services, qc, t.id, patch, versions.get(t.id));
          afterTaskSaved(qc, t.id, saved, patch, refresher.add);
        },
        move: async (t, columnId) => {
          // The column's kind goes with it, so a move kept offline shows under its new status (4c).
          const category = (await columnsOf(t.projectId).catch(() => [] as ApiColumn[])).find((c) => c.id === columnId)?.category;
          await sendTaskMove(services, { id: t.id, columnId, projectId: t.projectId, category });
          refresher.add(moveRefreshes(t.id, t.projectId));
        },
        assign: async (t, userId) => {
          const w = owned(services);
          const idempotencyKey = newIdempotencyKey();
          await sendItemWrite(itemLanes, w.order, { kind: 'task.assign', payload: { id: t.id, userIds: [userId] }, idempotencyKey }, () => w.resources.tasks.assign(t.id, [userId], { idempotencyKey }));
          refresher.add(assignmentRefreshes(t.id));
        },
        // A project whose columns can't be read (offline, none kept) has no Done column to use.
        doneColumnFor: async (t) => doneColumnOf(await columnsOf(t.projectId).catch(() => [])),
      };
      try {
        return await runBulk(tasks, action, deps, opts);
      } finally {
        refresher.finish([{ queryKey: ['tasks', 'mine'] }]);
      }
    },
    [services, qc],
  );
}
