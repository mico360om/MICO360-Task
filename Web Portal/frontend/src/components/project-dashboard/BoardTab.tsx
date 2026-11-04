import { useMemo } from 'react';
import type { ApiProject } from '../../api/projects';
import type { ProjectReadOnly } from '../../lib/project-archive';
import { Board } from '../board/Board';

/**
 * A project page's Board tab (1.22.3): the project's Kanban board — the Board page's own board
 * (components/board/Board.tsx), under the project page's header instead of the board page's title
 * and project picker. Cards are dragged between columns, added to a column and opened in the task
 * panel (Previous / Next follow the columns); the people strip, live updates and N are there too.
 * `readOnly` (1.22.3 review): the page's rule for an archived or completed project — the board is
 * there to look at, and says why.
 */
export function BoardTab({ project, readOnly = null }: { project: ApiProject; readOnly?: ProjectReadOnly | null }) {
  const projects = useMemo(() => [project], [project]);
  return <Board projectId={project.id} projects={projects} readOnly={readOnly} />;
}
