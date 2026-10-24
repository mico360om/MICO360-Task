import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { ProjectService } from '../projects/project-service';
import { DEFAULT_DAILY_LIMIT, DEFAULT_WORKING_HOURS, type WorkingHours } from '../settings/settings-service';
import { isCalendarDate } from '../tasks/validation';
import { NotFoundError, ValidationError } from '../../lib/http-errors';
import { shiftDayKey, todayKey, zonedStartOfDay } from '../../lib/due-date';
import { MAX_TIMELINE_WEEKS, MILESTONE_HORIZON_DAYS, buildTimeline, buildTimelineTasks, daysBetween, timelineRange, weekOf, type TimelineSource, type WeekStart } from './timeline';
import { buildWorkload, resolveWorkloadScope } from './workload';
import { loadWorkload, type WorkloadStore } from './workload-service';

export interface PlanningRouteDeps {
  guard: AuthGuard;
  projectService: Pick<ProjectService, 'listVisibleProjects' | 'getVisibleProject'>;
  /** Enables GET /timeline. */
  timeline?: TimelineSource;
  /** Enables GET /workload. */
  workload?: WorkloadStore;
  /** The company's working hours (days off) and the workload daily limit; defaults when absent. */
  settings?: { workingHours(): Promise<WorkingHours>; dailyLimit(): Promise<number> };
  /** Company time zone: "today", due days and meeting days are read in it. */
  timeZone: string;
  /** The time now (tests pin it). */
  now?: () => Date;
}

const weekStartParam = z.enum(['0', '1', '6']).optional().transform((v): WeekStart => (v === undefined ? 0 : (Number(v) as WeekStart)));
/** How far from today either page may look: two years each way. */
const REACH_DAYS = 730;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A 'YYYY-MM-DD' day within two years of today — anything else is a plain 400 (never a 500 from a far-off year). */
function dayParam(value: unknown, today: string, outOfReach: string, missing: string): string {
  if (typeof value !== 'string' || !DAY.test(value)) throw new ValidationError(missing);
  if (value < shiftDayKey(today, -REACH_DAYS) || value > shiftDayKey(today, REACH_DAYS)) throw new ValidationError(outOfReach);
  if (!isCalendarDate(value)) throw new ValidationError('That date doesn’t exist.');
  return value;
}

/** UTC midnight of a day: how a due date given as a day is stored. */
const utcDay = (key: string) => new Date(`${key}T00:00:00.000Z`);
/** Projects still going: the timeline leaves out completed and archived ones. */
const isOpen = (status: string) => status !== 'COMPLETED' && status !== 'ARCHIVED';

/**
 * The planning pages. GET /timeline: every open project the asker may see (as the projects list
 * decides), with its bar, status against its dates, milestones, meetings and the open tasks due each
 * week. GET /workload: open tasks due each day of a week per person, against the company's daily
 * limit, with suggestions for the days over it; an administrator sees everyone, a project manager the
 * teams of the projects they manage (only those projects' tasks, and their own tasks everywhere they
 * can see), anyone else only themselves. Each answers from a fixed number of grouped queries.
 */
export async function registerPlanningRoutes(app: FastifyInstance, deps: PlanningRouteDeps): Promise<void> {
  const { guard, timeZone } = deps;
  const now = () => deps.now?.() ?? new Date();
  const viewerOf = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  if (deps.timeline) {
    const source = deps.timeline;
    app.get('/timeline', { preHandler: guard.authenticate }, async (req) => {
      const q = req.query as Record<string, unknown>;
      const at = now();
      const today = todayKey(timeZone, at);
      const reach = 'Pick dates within two years of today.';
      const from = dayParam(q.from, today, reach, 'Say which days to show (from and to, YYYY-MM-DD).');
      const to = dayParam(q.to, today, reach, 'Say which days to show (from and to, YYYY-MM-DD).');
      const weekStart = weekStartParam.parse(q.weekStart);
      const range = timelineRange(from, to, weekStart);
      if (!range) throw new ValidationError(`Ask for 1 to ${MAX_TIMELINE_WEEKS} weeks, ending on or after the start.`);
      const projects = (await deps.projectService.listVisibleProjects(viewerOf(req))).filter((p) => isOpen(p.status));
      const ownerIds = [...new Set(projects.map((p) => p.ownerId).filter((id): id is string => !!id))];
      // Each read in its own window: the shown weeks' markers, the next 30 days' milestones (a day
      // either side, for due dates kept as days) and this week's meetings (moments, company time).
      const thisWeek = weekOf(today, weekStart);
      const rows = await source.load(projects.map((p) => p.id), ownerIds, {
        shownFrom: utcDay(shiftDayKey(range.from, -1)),
        shownTo: utcDay(shiftDayKey(range.to, 2)),
        soonFrom: utcDay(shiftDayKey(today, -1)),
        soonTo: utcDay(shiftDayKey(today, MILESTONE_HORIZON_DAYS + 2)),
        weekFrom: zonedStartOfDay(thisWeek, timeZone),
        weekTo: zonedStartOfDay(shiftDayKey(thisWeek, 7), timeZone),
      });
      return { data: buildTimeline(projects, rows, { timeZone, now: at, range, weekStart }) };
    });

    // One project's task rows for the shown weeks, read when its row is opened: the same projects as
    // the timeline (one the asker may see, not completed or archived), the same two-year reach.
    app.get('/timeline/projects/:id/tasks', { preHandler: guard.authenticate }, async (req) => {
      const { id } = req.params as { id: string };
      const q = req.query as Record<string, unknown>;
      const at = now();
      const today = todayKey(timeZone, at);
      const reach = 'Pick dates within two years of today.';
      const from = dayParam(q.from, today, reach, 'Say which days to show (from and to, YYYY-MM-DD).');
      const to = dayParam(q.to, today, reach, 'Say which days to show (from and to, YYYY-MM-DD).');
      if (to < from || daysBetween(from, to) >= MAX_TIMELINE_WEEKS * 7) throw new ValidationError(`Ask for 1 to ${MAX_TIMELINE_WEEKS} weeks, ending on or after the start.`);
      const project = await deps.projectService.getVisibleProject(id, viewerOf(req));
      if (!isOpen(project.status)) throw new NotFoundError('Project not found.');
      // A day either side of each bound, for due dates kept as days; the builder places each on its own day.
      const rows = await source.projectTasks(project.id, {
        from: utcDay(shiftDayKey(from, -1)),
        to: utcDay(shiftDayKey(to, 2)),
        overdueBefore: utcDay(shiftDayKey(today, 1)),
        upcomingFrom: utcDay(shiftDayKey(from > today ? from : today, -1)),
      });
      return { data: buildTimelineTasks(project.id, rows, { from, to, timeZone, now: at }) };
    });
  }

  if (deps.workload) {
    const store = deps.workload;
    app.get('/workload', { preHandler: guard.authenticate }, async (req) => {
      const q = req.query as Record<string, unknown>;
      const viewer = viewerOf(req);
      const admin = viewer.roles.includes('ADMIN');
      const at = now();
      const today = todayKey(timeZone, at);
      const week = dayParam(q.week, today, 'Pick a week within two years of today.', 'Say which week to show (week=YYYY-MM-DD).');
      const asked = typeof q.projectId === 'string' && q.projectId.trim() ? q.projectId.trim().slice(0, 191) : null;
      const [managed, visible, hours, limit] = await Promise.all([
        admin ? Promise.resolve([]) : store.managedProjectIds(viewer.id),
        admin ? Promise.resolve(null) : deps.projectService.listVisibleProjects(viewer).then((ps) => ps.map((p) => p.id)),
        deps.settings ? deps.settings.workingHours() : Promise.resolve(DEFAULT_WORKING_HOURS),
        deps.settings ? deps.settings.dailyLimit() : Promise.resolve(DEFAULT_DAILY_LIMIT),
      ]);
      const scope = resolveWorkloadScope(viewer, { managedProjectIds: managed, visibleProjectIds: visible });
      const { rows, projectId } = await loadWorkload(store, { scope, viewerId: viewer.id, projectId: asked, week, today, timeZone });
      return {
        data: buildWorkload(rows, { week, timeZone, now: at, limit, workingDays: hours.days, viewerId: viewer.id, scope, projectId, canChangeLimit: admin }),
      };
    });
  }
}
