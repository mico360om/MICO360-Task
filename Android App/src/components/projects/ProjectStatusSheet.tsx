import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/project-identity';
import type { Palette } from '../../lib/theme';
import type { ProjectOverview } from '../../lib/types';
import { useColors } from '../../core/theme';
import { ChoiceSheet } from '../my-tasks/ChoiceSheet';

/** The status's dot in the list (fill colours, as the website's menu: they show in light and dark). */
const dotOf = (c: Palette, status: string): string =>
  ({ PLANNING: c.info, ACTIVE: c.success, ON_HOLD: c.warning, COMPLETED: c.brand, ARCHIVED: c.ink3 })[status] ?? c.ink3;

/**
 * A project's status menu, as the website's ProjectStatusMenu: the five statuses with their colour
 * dot, the current one ticked; picking another changes it (Archived asks first — ArchiveProjectSheet).
 */
export function ProjectStatusSheet({ project, onChoose, onClose }: { project: ProjectOverview | null; onChoose: (project: ProjectOverview, status: string) => void; onClose: () => void }) {
  const c = useColors();
  return (
    <ChoiceSheet
      visible={!!project}
      title={project ? `Status of ${project.name}` : ''}
      options={PROJECT_STATUSES.map((st) => ({ value: st, label: projectStatusLabel(st), dot: dotOf(c, st) }))}
      value={project?.status}
      onChoose={(st) => {
        if (project && st !== project.status) onChoose(project, st);
      }}
      onClose={onClose}
    />
  );
}
