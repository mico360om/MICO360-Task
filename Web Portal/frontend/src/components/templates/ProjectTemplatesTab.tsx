import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { PROJECT_TEMPLATES_KEY, templatesApi, type ProjectTemplateSummary } from '../../api/templates';
import { ApiError } from '../../lib/api-client';
import { formatDueDay } from '../../lib/due-display';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { LoadError } from '../ui/LoadError';
import { ProjectFormDialog } from '../project-form/ProjectFormDialog';
import { ProjectTemplateEditor } from './ProjectTemplateEditor';
import { Chip, count, TemplateCard, TemplateGlyph } from './TemplateCard';

const failure = (err: unknown) => (err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : 'Please try again.');

/**
 * The Templates page's Projects tab: every project template (company-wide; everyone may use them).
 * "Use template" opens the New project form starting from it; its maker and administrators edit and
 * delete it; administrators create new ones here (anyone who runs a project saves one from its page).
 */
export function ProjectTemplatesTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const timeZone = useCompanyTimeZone();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const listQ = useQuery({ queryKey: PROJECT_TEMPLATES_KEY, queryFn: () => templatesApi(apiClient).listProjects() });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectTemplateSummary | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => templatesApi(apiClient).removeProjectTemplate(id),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: PROJECT_TEMPLATES_KEY });
    },
  });
  const templates = Array.isArray(listQ.data) ? listQ.data : [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 max-w-2xl text-sm text-ink-2">
          {isAdmin
            ? 'A template sets a new project’s board, its standard tasks and the roles that do them. Create one here, or save a project as a template from the project’s page.'
            : 'A template sets a new project’s board, its standard tasks and the roles that do them. Anyone who runs a project can save it as a template from the project’s page.'}
        </p>
        {/* An empty list offers the same button in its message: one call to action, not two. */}
        {isAdmin && !(listQ.isSuccess && templates.length === 0) ? (
          <Button onClick={() => setEditing('new')} className="!min-h-[44px]">
            {TemplateGlyph.plus}
            New project template
          </Button>
        ) : null}
      </div>

      {listQ.isError ? (
        <LoadError what="the project templates" onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading templates">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-2xl" aria-hidden="true" />)}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={TemplateGlyph.project}
          title="No project templates yet"
          description={isAdmin ? 'Create the first one, or open a project and choose “Save as template”.' : 'Open a project you run and choose “Save as template” to make the first one.'}
          action={isAdmin ? <Button onClick={() => setEditing('new')} className="!min-h-[44px]">New project template</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Project templates">
          {templates.map((t) => (
            <li key={t.id} className="grid min-w-0">
              <TemplateCard
                  kind="project"
                  name={t.name}
                  description={t.description}
                  chips={[
                    <Chip key="tasks">{count(t.taskCount, 'task')}</Chip>,
                    <Chip key="roles">{count(t.roleCount, 'role')}</Chip>,
                    <Chip key="columns">{count(t.columnCount, 'column')}</Chip>,
                  ]}
                  meta={
                    <>
                      {t.createdByName ? <>By <bdi>{t.createdByName}</bdi> · </> : null}
                      Updated {formatDueDay(t.updatedAt, timeZone)}
                    </>
                  }
                  onUse={() => setUsing(t.id)}
                  actions={
                    t.canManage
                      ? [
                          { label: 'Edit', icon: TemplateGlyph.edit, onSelect: () => setEditing(t.id) },
                          { label: 'Delete', icon: TemplateGlyph.trash, danger: true, onSelect: () => { remove.reset(); setDeleting(t); } },
                        ]
                      : []
                  }
                />
            </li>
          ))}
        </ul>
      )}

      {editing ? <ProjectTemplateEditor templateId={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {using ? <ProjectFormDialog templateId={using} onClose={() => setUsing(null)} onSaved={(p) => navigate(`/projects/${p.id}`)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          confirmLabel="Delete template"
          keepLabel="Keep it"
          busy={remove.isPending}
          error={remove.isError ? `Couldn’t delete it. ${failure(remove.error)}` : null}
          onConfirm={() => remove.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        >
          Projects already made from it stay as they are. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
