import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { TASK_TEMPLATES_KEY, templatesApi, type TaskTemplate } from '../../api/templates';
import { ApiError } from '../../lib/api-client';
import { formatDueDay } from '../../lib/due-display';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { LoadError } from '../ui/LoadError';
import { PriorityBadge } from '../ui/PriorityBadge';
import { TaskFormDialog } from '../task-form/TaskFormDialog';
import { TaskTemplateEditor } from './TaskTemplateEditor';
import { Chip, count, TemplateCard, TemplateGlyph } from './TemplateCard';

const failure = (err: unknown) => (err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : 'Please try again.');

/**
 * The Templates page's Tasks tab: every task template. "Use template" opens the New task form filled
 * in from it (title, description, checklist and priority, all still editable); its maker and
 * administrators edit and delete it; administrators create new ones (anyone who runs a project saves
 * one of its tasks from the task's panel).
 */
export function TaskTemplatesTab() {
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const listQ = useQuery({ queryKey: TASK_TEMPLATES_KEY, queryFn: () => templatesApi(apiClient).listTasks() });
  const [editing, setEditing] = useState<TaskTemplate | 'new' | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaskTemplate | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => templatesApi(apiClient).removeTaskTemplate(id),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: TASK_TEMPLATES_KEY });
    },
  });
  const templates = Array.isArray(listQ.data) ? listQ.data : [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 max-w-2xl text-sm text-ink-2">
          {isAdmin
            ? 'A task template fills in a new task’s title, description, checklist and priority. Create one here, or save a task as a template from its panel.'
            : 'A task template fills in a new task’s title, description, checklist and priority. Anyone who runs a project can save one of its tasks as a template from the task’s panel.'}
        </p>
        {/* An empty list offers the same button in its message: one call to action, not two. */}
        {isAdmin && !(listQ.isSuccess && templates.length === 0) ? (
          <Button onClick={() => setEditing('new')} className="!min-h-[44px]">
            {TemplateGlyph.plus}
            New task template
          </Button>
        ) : null}
      </div>

      {listQ.isError ? (
        <LoadError what="the task templates" onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading templates">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-36 rounded-2xl" aria-hidden="true" />)}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={TemplateGlyph.task}
          title="No task templates yet"
          description={isAdmin ? 'Create the first one, or open a task and choose “Save as template” in its ⋯ menu.' : 'Open a task in a project you run and choose “Save as template” in its ⋯ menu.'}
          action={isAdmin ? <Button onClick={() => setEditing('new')} className="!min-h-[44px]">New task template</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Task templates">
          {templates.map((t) => (
            <li key={t.id} className="grid min-w-0">
              <TemplateCard
                kind="task"
                name={t.name}
                description={t.title !== t.name ? <>Task: <bdi>{t.title}</bdi></> : t.description}
                chips={[
                  <PriorityBadge key="priority" priority={t.priority} />,
                  <Chip key="checklist">{t.checklist.length ? count(t.checklist.length, 'checklist item') : 'No checklist'}</Chip>,
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
                        { label: 'Edit', icon: TemplateGlyph.edit, onSelect: () => setEditing(t) },
                        { label: 'Delete', icon: TemplateGlyph.trash, danger: true, onSelect: () => { remove.reset(); setDeleting(t); } },
                      ]
                    : []
                }
              />
            </li>
          ))}
        </ul>
      )}

      {editing ? <TaskTemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {using ? <TaskFormDialog taskTemplateId={using} onClose={() => setUsing(null)} /> : null}
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
          Tasks already made from it stay as they are. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
