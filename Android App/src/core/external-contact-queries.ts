import { useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { owned } from './queries';
import { useDebouncedValue } from './useDebounced';
import { refresh } from '../lib/refresh';
import { newIdempotencyKey } from '../lib/idempotency';
import { externalContactRefreshes, type ContactDeps } from '../lib/task-external-contacts';
import type { ExternalContactFields } from '../lib/external-contacts';

/** Suggestions are asked for once typing pauses this long. */
const SUGGEST_PAUSE_MS = 250;

/**
 * Earlier contacts on this project's tasks whose name or company starts with what was typed (the
 * server's, at most 10, newest first) — asked once typing pauses; none for an empty box or without
 * a project. A failed read just shows none.
 */
export function useExternalContactSuggestions(projectId: string, typed: string) {
  const { resources } = useServices();
  const q = useDebouncedValue(typed.trim(), SUGGEST_PAUSE_MS);
  return useQuery({
    queryKey: ['external-contacts', 'suggest', projectId, q.toLowerCase()],
    queryFn: () => resources.tasks.externalContactSuggestions(projectId, q),
    enabled: !!projectId && q.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Add, change and remove a task's external contacts (each as the person making it now). They need
 * a connection — nothing is kept on the phone; a failure says why. Each change refreshes the task
 * (its details carry the contacts), its history and every list that shows its card line.
 */
export function useExternalContactMutations(taskId: string) {
  const services = useServices();
  const qc = useQueryClient();
  const after = () => refresh(qc, externalContactRefreshes(taskId));
  const add = useMutation({
    mutationFn: (fields: ExternalContactFields) => {
      const key = newIdempotencyKey();
      return owned(services).run((r) => r.tasks.addExternalContact(taskId, fields, { idempotencyKey: key }));
    },
    onSuccess: after,
  });
  const update = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: ExternalContactFields }) => owned(services).run((r) => r.tasks.updateExternalContact(id, fields)),
    onSuccess: after,
  });
  const remove = useMutation({
    mutationFn: (id: string) => owned(services).run((r) => r.tasks.removeExternalContact(id)),
    onSuccess: after,
  });
  /** The same writes for an Edit task form's save (lib/task-external-contacts saveContactChanges). */
  const deps = useMemo<ContactDeps>(
    () => ({
      add: (fields) => add.mutateAsync(fields),
      update: (id, fields) => update.mutateAsync({ id, fields }),
      remove: (id) => remove.mutateAsync(id),
    }),
    [add.mutateAsync, update.mutateAsync, remove.mutateAsync],
  );
  return { add, update, remove, deps };
}
