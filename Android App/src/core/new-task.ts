import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { writeOrder } from './queries';
import { asyncStore } from '../adapters/async-storage';
import { uploadPart } from '../lib/attachments';
import { sendInOrder } from '../lib/write-order';
import { lastProjectKey, sendNewTask, type NewTaskFile, type NewTaskInput, type NewTaskOutcome } from '../lib/task-form';

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
    const { resources } = services;
    return ({ input, key, files, onFile }) =>
      sendNewTask(
        {
          // Kept on this phone when it gets no answer, and sent later under the same key (never twice).
          createKept: (body, k) => sendInOrder(writeOrder(services), { kind: 'task.create', payload: body, idempotencyKey: k }, () => resources.tasks.create(body, { idempotencyKey: k })),
          createLive: (body, k) => resources.tasks.create(body, { idempotencyKey: k }),
          upload: (taskId, f, onProgress) => resources.tasks.uploadAttachment(taskId, uploadPart({ uri: f.uri, name: f.name, mimeType: f.mimeType }), onProgress),
          onFile,
        },
        { input, key, files },
      );
  }, [services]);
}
