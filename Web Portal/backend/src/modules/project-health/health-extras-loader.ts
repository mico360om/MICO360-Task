import { todayKey } from '../../lib/due-date';
import { WORKLOAD_MIN } from './health-facts';
import { attentionEdge, buildHealthExtras, type HealthExtras } from './health-extras';
import type { HealthSource } from './health-source';

/** Health extras for a list of projects, keyed by project id. */
export type HealthExtrasLoader = (projectIds: string[], at?: { now?: Date }) => Promise<Map<string, HealthExtras>>;

const unique = <T>(xs: T[]) => [...new Set(xs)];

/**
 * 1.23.5: the health extras of many projects in a fixed number of reads (about ten, however many
 * projects): their rows, completion figures, open load, attention tasks, those tasks' links and Blocked
 * moves, the due-date groups behind milestones due soon, and the names the risks need.
 */
export function createHealthExtrasLoader(source: HealthSource, timeZone: string): HealthExtrasLoader {
  return async (projectIds, at = {}) => {
    const ids = unique(projectIds);
    if (ids.length === 0) return new Map();
    const now = at.now ?? new Date();
    const today = todayKey(timeZone, now);
    const edge = attentionEdge(today);
    const [projects, figures, loads, tasks] = await Promise.all([source.projects(ids), source.figures(ids), source.openLoad(ids), source.attention(ids, edge)]);
    const taskIds = tasks.map((t) => t.id);
    const blockedIds = tasks.filter((t) => t.columnCategory === 'BLOCKED').map((t) => t.id);
    // A milestone due soon that waits on nothing is judged by the work due before it: only those projects' dates are read.
    const soonMilestoneProjects = unique(tasks.filter((t) => t.isMilestone && !t.waiting && t.dueDate && t.dueDate < edge).map((t) => t.projectId));
    const busy = unique(loads.flatMap((l) => l.people.filter((p) => p.count >= WORKLOAD_MIN).map((p) => p.userId)));
    const [links, moves, groups, people] = await Promise.all([
      source.links(taskIds),
      source.lastMoves(blockedIds),
      soonMilestoneProjects.length ? source.dueGroups(soonMilestoneProjects, edge) : Promise.resolve([]),
      source.people(busy),
    ]);
    const names = new Map<string, string>(people.map((p) => [p.id, p.name]));
    for (const t of tasks) for (const a of t.assignees) if (!names.has(a.id)) names.set(a.id, a.name);
    const moveOf = new Map(moves.map((m) => [m.taskId, m.at]));
    const ctx = { today, timeZone };
    const out = new Map<string, HealthExtras>();
    for (const project of projects) {
      const mine = tasks.filter((t) => t.projectId === project.id);
      const mineIds = new Set(mine.map((t) => t.id));
      out.set(
        project.id,
        buildHealthExtras(
          {
            project,
            figures: figures.find((f) => f.projectId === project.id),
            load: loads.find((l) => l.projectId === project.id),
            tasks: mine,
            links: links.filter((l) => mineIds.has(l.taskId) || mineIds.has(l.dependsOnTaskId)),
            moves: moveOf,
            dueGroups: groups.filter((g) => g.projectId === project.id),
            names,
          },
          ctx,
        ),
      );
    }
    return out;
  };
}
