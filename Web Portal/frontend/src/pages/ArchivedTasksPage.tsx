import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { tasksApi, type ApiTask } from '../api/tasks';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { ApiError } from '../lib/api-client';
import { archivedLine, archivedTasksKey, mayArchiveTasks } from '../lib/task-archive';
import { invalidateTaskQueries } from '../lib/task-cache';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useAuthStore } from '../stores/auth-store';
import { useOpenTask } from '../lib/useOpenTask';
import { usePageName } from '../lib/page-meta';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusPill } from '../components/ui/StatusPill';
import { TaskKey } from '../components/TaskKey';
import { ArchiveIcon } from '../components/task-archive/ArchivedBadge';

/**
 * Task archive (bulk lane): a project's archived tasks — hidden from its boards and lists, kept here
 * read-only (search finds them too). Anyone who sees the project may list them and open one (read-only in
 * the task panel); administrators and the people who run it Unarchive one to bring it back. One list that
 * reads as rows on a wide screen and as cards on a phone.
 */
export function ArchivedTasksPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const timeZone = useCompanyTimeZone();
  // As the task panel: archiving is work, so an administrator in Manager View may still unarchive (the server agrees).
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const openTask = useOpenTask();
  const projectQ = useQuery({ queryKey: ['project', id], queryFn: () => projectsApi(apiClient).get(id), enabled: !!id });
  const listQ = useQuery({ queryKey: archivedTasksKey(id), queryFn: () => tasksApi(apiClient).listArchived(id), enabled: !!id });
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const project = projectQ.data;
  usePageName(project ? `Archived tasks · ${project.name}` : 'Archived tasks');
  const rows: ApiTask[] = Array.isArray(listQ.data) ? listQ.data : [];
  const canUnarchive = mayArchiveTasks({ isAdmin, project: project ?? null });
  const nameOf = (userId: string | null | undefined) => {
    const u = userId ? (Array.isArray(directoryQ.data) ? directoryQ.data : []).find((d) => d.id === userId) : undefined;
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : null;
  };
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  const unarchiveM = useMutation({
    mutationFn: (t: ApiTask) => tasksApi(apiClient).unarchive(t.id),
    onMutate: () => setMessage(null),
    onSuccess: (_done, t) => {
      setMessage({ text: `${t.key} unarchived — back on its board.`, problem: false });
      void queryClient.invalidateQueries({ queryKey: archivedTasksKey(id) });
      void invalidateTaskQueries(queryClient);
    },
    onError: (e) => setMessage({ text: e instanceof ApiError && e.message && !/^Request failed/.test(e.message) ? e.message : 'Couldn’t unarchive it. Please try again.', problem: true }),
  });

  const ids = rows.map((t) => t.id);
  return (
    <div>
      {project ? (
        <Link to={`/projects/${encodeURIComponent(id)}`} className={`mb-1 inline-flex items-center gap-1 rounded-lg text-sm font-medium text-ink-2 hover:text-brand ${TOUCH_TALL}`}>
          <span aria-hidden="true" className="rtl:rotate-180">←</span>
          <bdi>{project.name}</bdi>
        </Link>
      ) : null}
      <PageHeader title="Archived tasks" subtitle="Hidden from the boards and lists, kept here read-only. Search still finds them. Unarchive one to bring it back." />

      {message ? (
        <p role={message.problem ? 'alert' : 'status'} className={`mb-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-medium ${message.problem ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className={`text-current opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>
            ✕
          </button>
        </p>
      ) : null}

      {listQ.isLoading ? (
        <p role="status" className="card card-pad text-ink-2">
          Loading…
        </p>
      ) : listQ.isError ? (
        <p role="alert" className="card card-pad text-danger">
          {listQ.error instanceof ApiError && (listQ.error.status === 403 || listQ.error.status === 404) ? 'Project not found, or you don’t have access to it.' : 'Couldn’t load the archived tasks.'}{' '}
          {listQ.error instanceof ApiError && (listQ.error.status === 403 || listQ.error.status === 404) ? null : (
            <button type="button" onClick={() => void listQ.refetch()} className="font-semibold underline">
              Retry
            </button>
          )}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ArchiveIcon size={24} />} title="No archived tasks." description="Archive a task from its ⋯ menu to hide it here, kept and read-only." />
      ) : (
        <>
          <p className="mb-2 text-xs text-ink-2" aria-live="polite">
            {rows.length === 1 ? '1 archived task' : `${rows.length} archived tasks`}
          </p>
          <ul aria-label="Archived tasks" className="card divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} data-archived-row={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 md:flex-nowrap">
                <button type="button" onClick={() => openTask(t.id, ids)} className={`group flex min-w-0 flex-1 basis-full items-center gap-2 text-start md:basis-auto ${TOUCH_TALL}`}>
                  <TaskKey value={t.key} />
                  <span dir="auto" className="min-w-0 truncate font-medium text-ink group-hover:text-brand group-hover:underline">
                    {t.title}
                  </span>
                </button>
                <StatusPill category={t.columnCategory} className="flex-none" />
                <span className="min-w-0 text-xs text-ink-2 md:w-52 md:flex-none">{archivedLine(t, nameOf(t.archivedById), timeZone)}</span>
                {canUnarchive ? (
                  <button
                    type="button"
                    onClick={() => unarchiveM.mutate(t)}
                    disabled={unarchiveM.isPending}
                    aria-label={`Unarchive ${t.key}`}
                    className={`ms-auto inline-flex h-8 flex-none items-center rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60 md:ms-0 ${TOUCH_TALL}`}
                  >
                    Unarchive
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
