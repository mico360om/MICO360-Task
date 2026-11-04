import { useMemo } from 'react';
import type { ApiProject } from '../../api/projects';
import { Board } from '../board/Board';

/**
 * A project page's Board tab (1.22.3): the project's Kanban board — the Board page's own board
 * (components/board/Board.tsx), under the project page's header instead of the board page's title
 * and project picker. Cards are dragged between columns, added to a column and opened in the task
 * panel (Previous / Next follow the columns); the people strip, live updates and N are there too.
 */
export function BoardTab({ project }: { project: ApiProject }) {
  const projects = useMemo(() => [project], [project]);
  return <Board projectId={project.id} projects={projects} />;
}
