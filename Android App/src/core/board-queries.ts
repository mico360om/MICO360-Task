import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { itemLanes } from '../lib/item-lanes';
import { columnActionError, columnSwapSteps } from '../lib/board-columns';
import type { ApiColumn, ColumnCategory } from '../lib/types';

/**
 * Manage columns (4b): each change goes in its column's lane (adding and reordering in the
 * project's), then the columns and the board are read again — whatever the answer, so what shows
 * is what the server has. Each action answers null when done, or why it wasn't (lib/board-columns
 * columnActionError: the server's words, or the website's connection message). It needs a
 * connection, as on the website.
 */
export function useColumnActions(projectId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const reload = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['columns', projectId] });
    void qc.invalidateQueries({ queryKey: ['tasks', 'project', projectId] });
  }, [qc, projectId]);
  const run = useCallback(
    async (lane: string, fn: () => Promise<unknown>): Promise<string | null> => {
      try {
        await itemLanes.run(lane, fn);
        return null;
      } catch (e) {
        return columnActionError(e);
      } finally {
        reload();
      }
    },
    [reload],
  );
  return useMemo(() => {
    const all = `columns:${projectId}`;
    const one = (id: string) => `column:${id}`;
    return {
      add: (name: string) => run(all, () => resources.columns.add(projectId, { name: name.trim() })),
      rename: (id: string, name: string) => run(one(id), () => resources.columns.update(id, { name: name.trim() })),
      recolour: (id: string, color: string) => run(one(id), () => resources.columns.update(id, { color })),
      setCategory: (id: string, category: ColumnCategory) => run(one(id), () => resources.columns.update(id, { category })),
      setEnabled: (id: string, enabled: boolean) => run(one(id), () => resources.columns.update(id, { enabled })),
      remove: (id: string) => run(one(id), () => resources.columns.remove(id)),
      /** Up or down one: three changes in order through a free place (the server keeps places unique). */
      move: (columns: ApiColumn[], id: string, dir: 'up' | 'down') =>
        run(all, async () => {
          for (const step of columnSwapSteps(columns, id, dir)) await resources.columns.update(step.id, { position: step.position });
        }),
    };
  }, [projectId, resources, run]);
}
