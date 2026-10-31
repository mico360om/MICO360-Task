import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { ApiError } from '../../lib/api-client';
import { externalContactsApi, type ApiExternalContact } from '../../api/external-contacts';
import { invalidateTaskQueries } from '../../lib/task-cache';
import type { ExternalContactFields } from '../../lib/external-contacts';
import { ExternalContactsSection } from './external-contacts';
import { changedContactFields } from '../task-form/ExternalContactsField';

/**
 * The task panel's "External contacts", saved on the server as each is added, changed or removed
 * (whoever may edit the task may change them; the server says when not). After each change the task,
 * its history and every view that shows its card line (board, lists, search…) are refreshed.
 */
export function TaskExternalContacts({ taskId, projectId, contacts }: { taskId: string; projectId: string; contacts: ApiExternalContact[] }) {
  const qc = useQueryClient();
  const api = externalContactsApi(apiClient);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId] });
    void qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    void invalidateTaskQueries(qc);
  };
  /** Run a change; one refused because the contact is gone (someone removed it) refreshes the task too, so it goes. */
  const change = async (write: () => Promise<unknown>) => {
    try {
      await write();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) refresh();
      throw err;
    }
    refresh();
  };
  const suggest = useCallback((typed: string) => externalContactsApi(apiClient).suggest(projectId, typed), [projectId]);
  return (
    <ExternalContactsSection
      contacts={contacts}
      suggest={suggest}
      onAdd={(fields: ExternalContactFields) => change(() => api.add(taskId, fields))}
      onSave={(id, fields) => {
        // Only the fields changed: a field someone else changed meanwhile is kept.
        const before = contacts.find((c) => c.id === id);
        const patch = before ? changedContactFields(before, fields) : fields;
        return change(async () => {
          if (Object.keys(patch).length) await api.update(id, patch);
        });
      }}
      onRemove={(id) => change(() => api.remove(id))}
    />
  );
}
