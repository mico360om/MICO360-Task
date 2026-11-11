import type { FastifyInstance, FastifyRequest } from 'fastify';
import { learnerHandlers, type TrainingRouteDeps } from './training-routes';

/**
 * The Client portal's Help & training (owner answer 1): client accounts only — the guard's route table
 * refuses staff sessions on /portal/*, and the learner service refuses a staff account again. Only
 * published courses for clients are ever found here; a staff course, lesson, file or attempt is
 * "not found". Clients get no notices (badges only: GET /portal/training/summary).
 */
export async function registerPortalTrainingRoutes(app: FastifyInstance, deps: TrainingRouteDeps): Promise<void> {
  const { learner } = deps;
  const h = learnerHandlers(deps, 'client');
  const me = (req: FastifyRequest) => req.user!.id;

  app.get('/portal/training', h.signedIn, async (req) => ({ data: await learner.portal(me(req)) }));
  app.get('/portal/training/summary', h.signedIn, async (req) => ({ data: await learner.summary(me(req)) }));
  app.get('/portal/training/courses/:id', h.signedIn, h.course);
  app.post('/portal/training/courses/:id/start', h.signedIn, h.start);
  app.get('/portal/training/lessons/:id', h.signedIn, h.lesson);
  app.put('/portal/training/lessons/:id/progress', h.progressLimit, h.progress);
  app.post('/portal/training/lessons/:id/complete', h.signedIn, h.complete);
  app.post('/portal/training/lessons/:id/attempts', h.signedIn, h.startAttempt);
  app.put('/portal/training/attempts/:id', h.progressLimit, h.saveAnswers);
  app.post('/portal/training/attempts/:id/submit', h.signedIn, h.submit);
  app.get('/portal/training/attempts/:id', h.signedIn, h.result);
  app.get('/portal/training/files/:id', h.fileLimit, h.file);
  app.get('/portal/training/certificates/:id/pdf', h.pdfLimit, h.certificatePdf);
  app.post('/portal/training/courses/:id/feedback', h.feedbackLimit, h.feedback);
  app.put('/portal/training/tour', h.signedIn, h.tour);
}
