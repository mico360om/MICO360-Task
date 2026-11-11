import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { trainingContext, type TrainingDeps } from './training-context';
import { createTrainingSync } from './training-sync';
import { createTrainingLearner, type TrainingLearner } from './training-learner';
import { createTrainingManage, type TrainingManage } from './training-manage';
import { createTrainingReports, type TrainingReports } from './training-report-service';
import { createTrainingSweeps } from './training-sweeps';
import { createTrainingStarter } from './training-starter';
import type { StarterCourse } from './starter/starter-types';
import { registerTrainingRoutes, type TrainingRouteDeps } from './training-routes';
import { registerPortalTrainingRoutes } from './portal-training-routes';
import { registerTrainingManageRoutes } from './training-manage-routes';
import { registerTrainingReportRoutes } from './training-report-routes';

/**
 * The Training Center wired to the database: the learner side (staff and the Client portal), the
 * Training Center (authoring, assignments, rules, feedback, certificates, settings), the reports, the
 * sweeps (hourly reminders, the 15-minute membership sync) and the starter content loaded once at boot.
 */
export function createTrainingFromPrisma(prisma: PrismaClient, d: Omit<TrainingDeps, 'prisma'> & { starterCourses?: readonly StarterCourse[]; starterAssetsDir?: string | null }) {
  const { starterCourses, starterAssetsDir, ...rest } = d;
  const ctx = trainingContext({ prisma, ...rest });
  const sync = createTrainingSync(ctx);
  const learner = createTrainingLearner(ctx, sync);
  const manage = createTrainingManage(ctx, sync);
  const reports = createTrainingReports(ctx);
  const sweeps = createTrainingSweeps(ctx, sync);
  const starter = createTrainingStarter({
    prisma,
    files: d.files,
    ...(starterCourses ? { courses: starterCourses } : {}),
    ...(starterAssetsDir !== undefined ? { assetsDir: starterAssetsDir } : {}),
    ...(d.now ? { now: d.now } : {}),
    ...(d.logger ? { logger: d.logger } : {}),
  });
  return { ctx, sync, learner, manage, reports, sweeps, starter };
}

/** What app.ts needs to register the Training Center's routes. */
export interface TrainingRoutesBundle extends Omit<TrainingRouteDeps, 'learner' | 'guard'> {
  learner: TrainingLearner;
  manage: TrainingManage;
  reports: TrainingReports;
  /** Who printed a report file (its footer says so). */
  userName?: (id: string) => Promise<string | null>;
}

export async function registerTraining(api: FastifyInstance, b: TrainingRoutesBundle & { guard: AuthGuard }): Promise<void> {
  const { learner, manage, reports, userName, guard, ...limits } = b;
  // Staff (/training/*) and the public certificate check; the Client portal (/portal/training/*).
  await registerTrainingRoutes(api, { learner, guard, ...limits });
  await registerPortalTrainingRoutes(api, { learner, guard, ...limits });
  // The Training Center (Training managers and administrators; settings: administrators).
  await registerTrainingManageRoutes(api, { manage, guard });
  // Reports (administrators all, Training managers their companies, project managers their team; read-only).
  await registerTrainingReportRoutes(api, { reports, guard, ...(userName ? { userName } : {}) });
}
