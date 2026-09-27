import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { columnsApi } from '../api/columns';
import { tasksApi, type NewTaskInput } from '../api/tasks';
import { membersApi } from '../api/members';
import { aiApi } from '../api/ai';
import { ApiError } from '../lib/api-client';
import { todayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { enqueueOffline } from '../lib/offline-replay';
import { newIdempotencyKey } from '../lib/offline-queue';
import { invalidateTaskQueries } from '../lib/task-cache';
import { QuickAddTaskForm, type QuickAddValues } from './QuickAddTaskForm';
import { FieldLabel } from './ui/Field';
import { SearchableSelect } from './ui/SearchableSelect';
import { useDialog } from '../hooks/useDialog';

export interface NewTaskModalProps {
  onClose: () => void;
  onCreated?: () => void;
  /** Lock the modal to one project (e.g. opened from a board) — hides the project picker. */
  projectId?: string;
}

/**
 * Global "New task" dialog usable from anywhere (header, My Tasks, …). Lets the
 * user pick a project (unless one is fixed) and a column, then create the task with
 * an optional set of assignees. Self-contained: fetches its own projects/columns/members.
 */
export function NewTaskModal({ onClose, onCreated, projectId: fixedProjectId }: NewTaskModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list(), enabled: !fixedProjectId });
  const projects = projectsQ.data ?? [];
  const [projectId, setProjectId] = useState(fixedProjectId ?? '');
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);

  const columnsQ = useQuery({
    queryKey: ['columns', projectId],
    enabled: Boolean(projectId),
    queryFn: () => columnsApi(apiClient).list(projectId),
  });
  const columns = useMemo(
    () => (columnsQ.data ?? []).filter((c) => c.enabled).sort((a, b) => a.position - b.position),
    [columnsQ.data],
  );
  const [columnId, setColumnId] = useState('');
  useEffect(() => {
    // Keep the selected column valid whenever the project (and its columns) change.
    if (columns.length && !columns.some((c) => c.id === columnId)) setColumnId(columns[0]!.id);
  }, [columns, columnId]);

  const membersQ = useQuery({
    queryKey: ['members', projectId],
    enabled: Boolean(projectId),
    queryFn: () => membersApi(apiClient).list(projectId),
  });
  const assigneeOptions = (membersQ.data ?? []).map((m) => ({
    id: m.id,
    label: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.username,
  }));

  const timeZone = useCompanyTimeZone();

  // One request creates the task with its due date and chosen assignees (so the project owner isn't
  // added on top, and nothing is left half-done if a second call fails). The Idempotency-Key is reused
  // by the offline queue, so a create that did reach the server is never duplicated on replay.
  const createMut = useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: NewTaskInput; idempotencyKey: string }) =>
      tasksApi(apiClient).create(input, { idempotencyKey }),
    onSuccess: () => {
      // Refresh everything the new task could appear in (board, My Tasks, calendar, project, dashboard…).
      void invalidateTaskQueries(qc);
      onCreated?.();
      onClose();
    },
    onError: (e, vars) => {
      // Offline: keep the task and send it when the connection returns (server errors stay on screen).
      if (!(e instanceof ApiError) && enqueueOffline('task.create', vars.input, { idempotencyKey: vars.idempotencyKey })) {
        onClose();
      }
    },
  });

  function submit(v: QuickAddValues) {
    if (!columnId) return;
    const input: NewTaskInput = {
      projectId,
      columnId,
      title: v.title,
      priority: v.priority,
      ...(v.description ? { description: v.description } : {}),
      ...(v.dueDate ? { dueDate: v.dueDate } : {}),
      // Only when someone was picked — otherwise the project's default (its owner) applies.
      ...(v.assigneeIds.length ? { assigneeIds: v.assigneeIds } : {}),
    };
    createMut.mutate({ input, idempotencyKey: newIdempotencyKey() });
  }

  const noProjects = !fixedProjectId && projectsQ.isSuccess && projects.length === 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="New task" className="card relative w-full max-w-md animate-scale-in p-6">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">New task</h2>

        {noProjects ? (
          <p className="text-sm text-ink-2">Create a project first, then you can add tasks to it.</p>
        ) : (
          <>
            {createMut.isError ? (
              <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {createMut.error instanceof ApiError && createMut.error.message ? createMut.error.message : 'Couldn’t create the task. Please try again.'}
              </p>
            ) : null}

            {!fixedProjectId ? (
              <div className="mb-3 flex flex-col gap-1.5">
                <FieldLabel>Project</FieldLabel>
                <SearchableSelect
                  ariaLabel="Project"
                  value={projectId}
                  onChange={(v) => setProjectId(v)}
                  options={projects.map((p) => ({ value: p.id, label: p.name, hint: p.code }))}
                />
              </div>
            ) : null}

            <div className="mb-3 flex flex-col gap-1.5">
              <FieldLabel>Column</FieldLabel>
              <SearchableSelect
                ariaLabel="Column"
                value={columnId}
                onChange={(v) => setColumnId(v)}
                disabled={columns.length === 0}
                placeholder={columns.length === 0 ? 'Loading…' : 'Select a column'}
                options={columns.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>

            <QuickAddTaskForm
              submitting={createMut.isPending}
              assignees={assigneeOptions}
              // "today" in the company time zone, so "tomorrow" means the company's tomorrow.
              onParse={(text) => aiApi(apiClient).parseTask(text, todayKey(timeZone))}
              onSubmit={submit}
            />
          </>
        )}

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
