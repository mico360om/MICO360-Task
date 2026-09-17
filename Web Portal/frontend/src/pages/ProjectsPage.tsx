import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi, type ProjectStatus } from '../api/projects';
import { tasksApi } from '../api/tasks';
import { usersApi } from '../api/users';
import { apiClient } from '../api/client';
import { ProjectsList, type ProjectCardMeta } from '../components/ProjectsList';
import { NewProjectModal } from '../components/NewProjectModal';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/auth-store';

export function ProjectsPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuthStore();
  const admin = isAdmin();
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi(apiClient).list(),
  });
  // Rollups for richer cards: task stats per project + owner identity.
  const tasksQ = useQuery({ queryKey: ['tasks', 'all'], queryFn: () => tasksApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const projects = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const meta = useMemo<Record<string, ProjectCardMeta>>(() => {
    const dir = Array.isArray(dirQ.data) ? dirQ.data : [];
    const tasks = Array.isArray(tasksQ.data) ? tasksQ.data : [];
    const now = Date.now();
    const agg = new Map<string, { total: number; done: number; overdue: number }>();
    for (const t of tasks) {
      const s = agg.get(t.projectId) ?? { total: 0, done: 0, overdue: 0 };
      s.total += 1;
      const cat = t.columnCategory ?? 'TODO';
      if (cat === 'DONE' || t.completedAt) s.done += 1;
      else if (t.dueDate && new Date(t.dueDate).getTime() < now) s.overdue += 1;
      agg.set(t.projectId, s);
    }
    const out: Record<string, ProjectCardMeta> = {};
    for (const p of projects) {
      const s = agg.get(p.id) ?? { total: 0, done: 0, overdue: 0 };
      const o = dir.find((d) => d.id === p.ownerId);
      out[p.id] = {
        total: s.total,
        overdue: s.overdue,
        completedPct: s.total ? Math.round((s.done / s.total) * 100) : 0,
        ownerName: o ? `${o.firstName} ${o.lastName}`.trim() || o.username : null,
        ownerAvatar: o?.avatarUrl ?? null,
      };
    }
    return out;
  }, [tasksQ.data, dirQ.data, projects]);

  const statusMut = useMutation({
    // Choosing ARCHIVED routes through the first-class archive action (audited); any other status is a plain update.
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      status === 'ARCHIVED' ? projectsApi(apiClient).archive(id) : projectsApi(apiClient).update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        subtitle={admin ? 'Create, browse and manage your projects.' : 'Browse and open the projects you have access to.'}
        actions={admin ? <Button onClick={() => setShowNew(true)}>+ New project</Button> : undefined}
      />
      <div>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card h-32 p-5">
                <div className="skeleton h-4 w-16" />
                <div className="skeleton mt-4 h-5 w-32" />
                <div className="skeleton mt-3 h-3 w-24" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <p role="alert" className="text-danger">
            Couldn’t load projects. Is the API running?
          </p>
        ) : (
          <ProjectsList
            projects={projects}
            meta={meta}
            canManage={admin}
            onChangeStatus={(id, status) => statusMut.mutate({ id, status })}
          />
        )}
      </div>

      {showNew ? <NewProjectModal onClose={() => setShowNew(false)} /> : null}
    </div>
  );
}
