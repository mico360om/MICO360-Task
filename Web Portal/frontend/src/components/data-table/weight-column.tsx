import type { ApiProject } from '../../api/projects';
import type { ApiTask } from '../../api/tasks';
import { countsByWeight, effectiveWeight, projectWeights, weightChoices } from '../../lib/project-health';
import { SearchableSelect } from '../ui/SearchableSelect';
import type { DataColumn } from './DataTable';

/**
 * 1.23.5: the Table view's "Weight" column — only when one of its rows' projects counts completion by
 * weight; quick-editable where the row is (1–10 points, or the project's default for its priority). A row
 * of a project counting by number shows a dash.
 */
export function weightColumns({
  tasks,
  projectOf,
  editable,
  onSave,
}: {
  tasks: readonly ApiTask[];
  projectOf: (t: ApiTask) => ApiProject | undefined;
  editable: (t: ApiTask) => boolean;
  onSave: (t: ApiTask, weight: number | null) => void;
}): DataColumn<ApiTask>[] {
  if (!tasks.some((t) => countsByWeight(projectOf(t)))) return [];
  return [
    {
      id: 'weight',
      label: 'Weight',
      className: 'w-px whitespace-nowrap',
      cell: (t) => {
        const project = projectOf(t);
        if (!countsByWeight(project)) return <span className="text-ink-3">—</span>;
        const fallback = projectWeights(project)[t.priority];
        const value = t.weight == null ? '' : String(t.weight);
        if (!editable(t)) {
          return (
            <span className="text-xs tabular-nums text-ink-2" title={t.weight == null ? `The default for its priority (${fallback})` : undefined}>
              {effectiveWeight(t, project)}
              {t.weight == null ? <span className="text-ink-3"> (default)</span> : null}
            </span>
          );
        }
        return (
          <SearchableSelect
            size="chip"
            ariaLabel={`Weight of ${t.key}: ${t.weight == null ? `default, ${fallback}` : t.weight}`}
            value={value}
            onChange={(v) => v !== value && onSave(t, v ? Number(v) : null)}
            options={weightChoices(fallback)}
            chipClassName="bg-ground text-ink-2 tabular-nums"
          />
        );
      },
    },
  ];
}
