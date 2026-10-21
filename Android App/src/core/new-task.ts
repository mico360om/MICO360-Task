import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { owned, sendTaskEdit, sendTaskMove } from './queries';
import { asyncStore } from '../adapters/async-storage';
import { uploadPart } from '../lib/attachments';
import { sendInOrder } from '../lib/write-order';
import { lastProjectKey, saveTaskEdit, sendNewTask, type EditDeps, type EditOutcome, type NewTaskFile, type NewTaskInput, type NewTaskOutcome, type TaskDraft } from '../lib/task-form';
import { newIdempotencyKey } from '../lib/idempotency';
import { itemLanes, sendItemWrite } from '../lib/item-lanes';
import { refresh } from '../lib/refresh';
import { afterTaskSaved, assignmentRefreshes, moveRefreshes } from '../lib/task-cache';
import type { ApiColumn } from '../lib/types';

/**
 * The New task form's server side (4a): Describe, the project used last time, and sending — the
 * task through the offline queue under its key (lib/task-form sendNewTask), its files after it.
 */

/** "Describe it in plain English": what the sentence fills in (today = the company's day). Needs a connection. */
export function useParseTask() {
  const { resources } = useServices();
  return useMutation({ mutationFn: ({ text, today }: { text: string; today: string }) => resources.ai.parseTask(text, today) });
}

/**
 * The project a new task went to last time on this phone, for this person (the website keeps it in
 * the browser): undefined while it is read, null when none.
 */
export function useLastProject(): [string | null | undefined, (projectId: string) => void] {
  const userId = useUserId();
  const [last, setLast] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setLast(null);
      return;
    }
    asyncStore
      .getItem(lastProjectKey(userId))
      .then((v) => alive && setLast(v || null))
      .catch(() => alive && setLast(null));
    return () => {
      alive = false;
    };
  }, [userId]);
  const remember = useCallback(
    (projectId: string) => {
      if (userId) void asyncStore.setItem(lastProjectKey(userId), projectId).catch(() => {});
    },
    [userId],
  );
  return [last, remember];
}

/** Send a new task (and then its files): the outcome says what the form does next. */
export function useSendNewTask(): (req: { input: NewTaskInput; key: string; files: readonly NewTaskFile[]; onFile: (key: string, patch: Partial<NewTaskFile>) => void }) => Promise<NewTaskOutcome> {
  const services = useServices();
  return useMemo(() => {
    return ({ input, key, files, onFile }) => {
      // The person creating it, now: the task and each of its files go as them only — a switch of
      // person while it sends stops the rest (SESSION_CHANGED), never sends it as the next person.
      const w = owned(services);
      return sendNewTask(
        {
          // Kept on this phone when it gets no answer, and sent later under the same key (never twice).
          createKept: (body, k) => sendInOrder(w.order, { kind: 'task.create', payload: body, idempotencyKey: k }, () => w.resources.tasks.create(body, { idempotencyKey: k })),
          createLive: (body, k) => w.resources.tasks.create(body, { idempotencyKey: k }),
          upload: (taskId, f, onProgress) => w.resources.tasks.uploadAttachment(taskId, uploadPart({ uri: f.uri, name: f.name, mimeType: f.mimeType }), onProgress),
          onFile,
        },
        { input, key, files },
      );
    };
  }, [services]);
}

/**
 * Save Edit task's changes (4d), as the website's form does (lib/task-form saveTaskEdit): only what
 * changed, each through the task write path — the edit against the version the form opened with
 * (a colleague's change meanwhile is refused, not overwritten), the column as a move, the people as
 * assignments — each kept on this phone when it gets no answer, each refreshing what it changed.
 */
export function useSaveTaskEdit(taskId: string): (draft: TaskDraft, saved: TaskDraft, o: { series: boolean; canRepeat: boolean; projectId: string; openedVersion?: number }) => Promise<EditOutcome> {
  const services = useServices();
  const qc = useQueryClient();
  return useCallback(
    (draft, saved, { series, canRepeat, projectId, openedVersion }) => {
      const deps: EditDeps = {
        update: async (patch) => {
          const done = await sendTaskEdit(services, qc, taskId, patch, undefined, openedVersion);
          afterTaskSaved(qc, taskId, done, patch);
        },
        move: async (columnId) => {
          // The column's kind goes with it, so a move kept offline shows under its new status (4c).
          const category = qc.getQueryData<ApiColumn[]>(['columns', projectId])?.find((c) => c.id === columnId)?.category;
          await sendTaskMove(services, { id: taskId, columnId, projectId, category });
          refresh(qc, moveRefreshes(taskId, projectId));
        },
        assign: async (userIds) => {
          const w = owned(services);
          const idempotencyKey = newIdempotencyKey();
          await sendItemWrite(itemLanes, w.order, { kind: 'task.assign', payload: { id: taskId, userIds }, idempotencyKey }, () => w.resources.tasks.assign(taskId, userIds, { idempotencyKey }));
          refresh(qc, assignmentRefreshes(taskId));
        },
        unassign: async (userId) => {
          const w = owned(services);
          await sendItemWrite(itemLanes, w.order, { kind: 'task.unassign', payload: { id: taskId, userId } }, () => w.resources.tasks.unassign(taskId, userId));
          refresh(qc, assignmentRefreshes(taskId));
        },
      };
      return saveTaskEdit(deps, draft, saved, { series, canRepeat });
    },
    [services, qc, taskId],
  );
}
