import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AiFeatureService } from './ai-feature-service';
import type { AuthGuard } from '../auth/auth-guard';

// Bounded inputs: every field ends up in a paid prompt, so size is capped here (AI-02).
const title = z.string().trim().min(1).max(300);
const description = z.string().max(4000);
const breakdownSchema = z.object({ title, description: description.optional() });
const parseSchema = z.object({ text: z.string().trim().min(1).max(1000), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const count = z.number().int().min(0).max(1_000_000);
const summarySchema = z.object({
  name: z.string().trim().min(1).max(200),
  stats: z.object({ total: count, completed: count, inProgress: count, overdue: count }),
  sampleTitles: z.array(z.string().max(300)).max(20).optional(),
});
const prioritySchema = z.object({ title, description: description.optional(), dueDate: z.string().max(40).nullable().optional() });

export interface AiFeatureRouteDeps {
  aiFeatureService: AiFeatureService;
  guard: AuthGuard;
}

const requester = (req: FastifyRequest) => ({ userId: req.user!.id });

/** Product-facing AI endpoints (task breakdown, NL capture, project summary, priority) — any signed-in user, rate-limited per user. */
export async function registerAiFeatureRoutes(app: FastifyInstance, deps: AiFeatureRouteDeps): Promise<void> {
  const { aiFeatureService, guard } = deps;

  app.post('/ai/breakdown', { preHandler: guard.authenticate }, async (req) => {
    const body = breakdownSchema.parse(req.body);
    return { data: { items: await aiFeatureService.breakdownTask(body, requester(req)) } };
  });

  app.post('/ai/parse-task', { preHandler: guard.authenticate }, async (req) => {
    const body = parseSchema.parse(req.body);
    return { data: await aiFeatureService.parseTask(body, requester(req)) };
  });

  app.post('/ai/summary', { preHandler: guard.authenticate }, async (req) => {
    const body = summarySchema.parse(req.body);
    return { data: { summary: await aiFeatureService.summarizeProject(body, requester(req)) } };
  });

  app.post('/ai/suggest-priority', { preHandler: guard.authenticate }, async (req) => {
    const body = prioritySchema.parse(req.body);
    return { data: await aiFeatureService.suggestPriority(body, requester(req)) };
  });
}
