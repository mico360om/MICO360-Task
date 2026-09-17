import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AiFeatureService } from './ai-feature-service';
import type { AuthGuard } from '../auth/auth-guard';

const breakdownSchema = z.object({ title: z.string().min(1), description: z.string().optional() });
const parseSchema = z.object({ text: z.string().min(1), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const summarySchema = z.object({
  name: z.string().min(1),
  stats: z.object({ total: z.number().int().min(0), completed: z.number().int().min(0), inProgress: z.number().int().min(0), overdue: z.number().int().min(0) }),
  sampleTitles: z.array(z.string()).optional(),
});
const prioritySchema = z.object({ title: z.string().min(1), description: z.string().optional(), dueDate: z.string().nullable().optional() });

export interface AiFeatureRouteDeps {
  aiFeatureService: AiFeatureService;
  guard: AuthGuard;
}

/** Product-facing AI endpoints (task breakdown, NL capture, project summary, priority) — any signed-in user. */
export async function registerAiFeatureRoutes(app: FastifyInstance, deps: AiFeatureRouteDeps): Promise<void> {
  const { aiFeatureService, guard } = deps;

  app.post('/ai/breakdown', { preHandler: guard.authenticate }, async (req) => {
    const body = breakdownSchema.parse(req.body);
    return { data: { items: await aiFeatureService.breakdownTask(body) } };
  });

  app.post('/ai/parse-task', { preHandler: guard.authenticate }, async (req) => {
    const body = parseSchema.parse(req.body);
    return { data: await aiFeatureService.parseTask(body) };
  });

  app.post('/ai/summary', { preHandler: guard.authenticate }, async (req) => {
    const body = summarySchema.parse(req.body);
    return { data: { summary: await aiFeatureService.summarizeProject(body) } };
  });

  app.post('/ai/suggest-priority', { preHandler: guard.authenticate }, async (req) => {
    const body = prioritySchema.parse(req.body);
    return { data: await aiFeatureService.suggestPriority(body) };
  });
}
