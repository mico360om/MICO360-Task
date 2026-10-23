import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { ProjectService } from '../projects/project-service';
import { DEFAULT_DAILY_LIMIT, DEFAULT_WORKING_HOURS, type WorkingHours } from '../settings/settings-service';
import { calendarDay, idString } from '../tasks/validation';
import { ValidationError } from '../../lib/http-errors';
import { shiftDayKey, todayKey, zonedStartOfDay } from '../../lib/due-date';
import { MAX_TIMELINE_WEEKS, buildTimeline, timelineRange, weekOf, type TimelineSource, type WeekStart } from './timeline';
import { buildWorkload, resolveWorkloadScope, workloadWindow, type WorkloadSource } from './workload';

export interface PlanningRouteDeps {
  guard: AuthGuard;
  projectService: Pick<ProjectService, 'listVisibleProjects'>;
  /** Enables GET /timeline. */
  timeline?: TimelineSource;
  /** Enables GET /workload. */
  workload?: WorkloadSource;
  /** The company's working hours (days off) and the workload daily limit; defaults when absent. */
  settings?: { workingHours(): Promise<WorkingHours>; dailyLimit(): Promise<number> };
  /** Company time zone: "today", due days and meeting days are read in it. */
  timeZone: string;
  /** The time now (tests pin it). */
  now?: () => Date;
}

const weekStartParam = z.enum(['0', '1', '6']).optional().transform((v): WeekStart => (v === undefined ? 0 : (Number(v) as WeekStart)));
const timelineQuery = z.object({ from: calendarDay, to: calendarDay, weekStart: weekStartParam });
const workloadQuery = z.object({ week: calendarDay, projectId: idString.optional() });

/** Projects still going: the timeline leaves out completed and archived ones. */
const isOpen = (status: string) => status !== 'COMPLETED' && status !== 'ARCHIVED';
/** UTC midnight of a day: how a due date given as a day is stored. */
const utcDay = (key: string) => new Date(`${key}T00:00:00.000Z`);

/**
 * The planning pages. GET /timeline: every open project the asker may see (as the projects list
 * decides), with its bar, status against its dates, milestones, meetings and the open tasks due each
 * week. GET /workload: open tasks due each day of a week per person, against the company's daily
 * limit, with suggestions for the days over it; an administrator sees everyone, a project manager the
 * teams of the projects they manage (only those projects' tasks), anyone else only themselves.
 * Each answers from a fixed number of grouped queries, however many projects or people there are.
 */
export async function registerPlanningRoutes(app: FastifyInstance, deps: PlanningRouteDeps): Promise<void> {
  const { guard, timeZone } = deps;
  const now = () => deps.now?.() ?? new Date();
  const viewerOf = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  if (deps.timeline) {
    const source = deps.timeline;
    app.get('/timeline', { preHandler: guard.authenticate }, async (req) => {
      const { from, to, weekStart } = timelineQuery.parse(req.query);
      const range = timelineRange(from, to, weekStart);
      if (!range) throw new ValidationError(`Ask for 1 to ${MAX_TIMELINE_WEEKS} weeks, ending on or after the start.`);
      const at = now();
      const projects = (await deps.projectService.listVisibleProjects(viewerOf(req))).filter((p) => isOpen(p.status));
      const ownerIds = [...new Set(projects.map((p) => p.ownerId).filter((id): id is string => !!id))];
      // The shown weeks' meetings, and this week's (for "Meetings this week") when it is not among them.
      const thisWeek = weekOf(todayKey(timeZone, at), weekStart);
      const first = thisWeek < range.from ? thisWeek : range.from;
      const last = shiftDayKey(thisWeek, 6) > range.to ? shiftDayKey(thisWeek, 6) : range.to;
      const rows = await source.load(
        projects.map((p) => p.id),
        ownerIds,
        { meetingsFrom: zonedStartOfDay(first, timeZone), meetingsTo: zonedStartOfDay(shiftDayKey(last, 1), timeZone) },
      );
      return { data: buildTimeline(projects, rows, { timeZone, now: at, range, weekStart }) };
    });
  }

  if (deps.workload) {
    const source = deps.workload;
    app.get('/workload', { preHandler: guard.authenticate }, async (req) => {
      const { week, projectId } = workloadQuery.parse(req.query);
      const viewer = viewerOf(req);
      const admin = viewer.roles.includes('ADMIN');
      const at = now();
      const today = todayKey(timeZone, at);
      const [managed, visible, hours, limit] = await Promise.all([
        admin ? Promise.resolve([]) : source.managedProjectIds(viewer.id),
        admin ? Promise.resolve(null) : deps.projectService.listVisibleProjects(viewer).then((ps) => ps.map((p) => p.id)),
        deps.settings ? deps.settings.workingHours() : Promise.resolve(DEFAULT_WORKING_HOURS),
        deps.settings ? deps.settings.dailyLimit() : Promise.resolve(DEFAULT_DAILY_LIMIT),
      ]);
      const scope = resolveWorkloadScope(viewer, { managedProjectIds: managed, visibleProjectIds: visible });
      // Due dates are days (UTC midnight) or moments read in company time: a day either side covers both.
      const window = workloadWindow(week, today);
      const rows = await source.load({
        scope,
        viewerId: viewer.id,
        from: utcDay(shiftDayKey(window.from, -1)),
        to: utcDay(shiftDayKey(window.to, 2)),
        overdueBefore: utcDay(shiftDayKey(today, 1)),
      });
      return {
        data: buildWorkload(rows, { week, timeZone, now: at, limit, workingDays: hours.days, viewerId: viewer.id, scope, projectId, canChangeLimit: admin }),
      };
    });
  }
}
