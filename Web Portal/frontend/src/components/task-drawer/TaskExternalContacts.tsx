import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { externalContactsApi, type ApiExternalContact } from '../../api/external-contacts';
import { invalidateTaskQueries } from '../../lib/task-cache';
import type { ExternalContactFields } from '../../lib/external-contacts';
import { ExternalContactsSection } from './external-contacts';

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
  const suggest = useCallback((typed: string) => externalContactsApi(apiClient).suggest(projectId, typed), [projectId]);
  return (
    <ExternalContactsSection
      contacts={contacts}
      suggest={suggest}
      onAdd={async (fields: ExternalContactFields) => {
        await api.add(taskId, fields);
        refresh();
      }}
      onSave={async (id, fields) => {
        await api.update(id, fields);
        refresh();
      }}
      onRemove={async (id) => {
        await api.remove(id);
        refresh();
      }}
    />
  );
}
