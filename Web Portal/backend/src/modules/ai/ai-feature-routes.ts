import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AiFeatureService, DraftAgendaInput } from './ai-feature-service';
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
const sentence = z.string().max(1000);
const draftAgendaSchema = z.object({
  title,
  description: description.optional(),
  text: sentence.optional(),
  projectId: z.string().min(1).nullable().optional(),
  startAt: z.coerce.date(),
  minutes: z.number().int().min(5).max(720),
  peopleIds: z.array(z.string().min(1)).max(100),
  meetingId: z.string().min(1).optional(),
});
const describeMeetingSchema = z.object({ title, agenda: z.array(z.string().trim().min(1).max(300)).max(30).optional(), text: sentence.optional() });

export interface AiFeatureRouteDeps {
  aiFeatureService: AiFeatureService;
  guard: AuthGuard;
  /** Draft agenda's project tasks and last meeting's leftovers, gathered with the person's access. */
  agendaSources?: AgendaSourcesFor;
  /** Names of the invited people (ids that aren't users are left out). */
  userNames?: (ids: string[]) => Promise<Map<string, string>>;
}

export type AgendaSourcesFor = (
  requester: { userId: string; roles: string[] },
  input: { projectId: string | null; startAt: Date; meetingId?: string },
) => Promise<Pick<DraftAgendaInput, 'tasks' | 'leftovers'>>;

const requester = (req: FastifyRequest) => ({ userId: req.user!.id, roles: req.user!.roles ?? [] });

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

  app.post('/ai/parse-meeting', { preHandler: guard.authenticate }, async (req) => {
    const body = parseSchema.parse(req.body);
    return { data: await aiFeatureService.parseMeeting(body, requester(req)) };
  });

  app.post('/ai/draft-agenda', { preHandler: guard.authenticate }, async (req) => {
    const { peopleIds, projectId, startAt, meetingId, ...body } = draftAgendaSchema.parse(req.body);
    const who = requester(req);
    const [sources, names] = await Promise.all([
      deps.agendaSources ? deps.agendaSources(who, { projectId: projectId ?? null, startAt, ...(meetingId ? { meetingId } : {}) }) : { tasks: [], leftovers: [] },
      deps.userNames ? deps.userNames([...new Set(peopleIds)]) : new Map<string, string>(),
    ]);
    const people = [...names].map(([id, name]) => ({ id, name }));
    return { data: { items: await aiFeatureService.draftAgenda({ ...body, people, ...sources }, who) } };
  });

  app.post('/ai/write-meeting-description', { preHandler: guard.authenticate }, async (req) => {
    const body = describeMeetingSchema.parse(req.body);
    return { data: { description: await aiFeatureService.writeMeetingDescription(body, requester(req)) } };
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
