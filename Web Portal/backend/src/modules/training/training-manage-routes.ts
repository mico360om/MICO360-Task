import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { ValidationError } from '../../lib/http-errors';
import { fileTooLargeMessage } from '../../lib/upload-safety';
import type { TrainingUpload } from './training-files';
import type { TrainingManage } from './training-manage';
import { LIMITS } from './training-types';

/**
 * The Training Center over HTTP (owner answers 4, 7, 11–16): /training/manage/* for Training managers and
 * administrators — the service refuses anyone else (403) before it reads anything — and /training/settings
 * for administrators. Staff routes: a client account's session is refused by the guard's route table.
 * Files may be up to 25 MB here (a per-request limit; the app-wide multipart limit stays 10 MB).
 */
export interface TrainingManageRouteDeps {
  manage: TrainingManage;
  guard: AuthGuard;
}

type Params = { id?: string };

/** The one file of a multipart request (≤ 25 MB) and its text fields; plain words when it is too big or missing. */
async function readUpload(req: FastifyRequest): Promise<{ file: TrainingUpload; fields: Record<string, string> }> {
  const tooLarge = (err: unknown) => (err as { code?: string })?.code === 'FST_REQ_FILE_TOO_LARGE';
  let part;
  try {
    part = await req.file({ limits: { fileSize: LIMITS.documentBytes, files: 1 } });
  } catch (err) {
    if (tooLarge(err)) throw new ValidationError(fileTooLargeMessage(LIMITS.documentBytes));
    if ((err as { code?: string })?.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') throw new ValidationError('Choose a file to upload.');
    throw err;
  }
  if (!part) throw new ValidationError('Choose a file to upload.');
  let content: Buffer;
  try {
    content = await part.toBuffer();
  } catch (err) {
    if (tooLarge(err)) throw new ValidationError(fileTooLargeMessage(LIMITS.documentBytes));
    throw err;
  }
  if (part.file.truncated) throw new ValidationError(fileTooLargeMessage(LIMITS.documentBytes));
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(part.fields ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first && first.type === 'field' && typeof first.value === 'string') fields[name] = first.value;
  }
  return { file: { filename: part.filename, mimeType: part.mimetype, content }, fields };
}

export async function registerTrainingManageRoutes(app: FastifyInstance, deps: TrainingManageRouteDeps): Promise<void> {
  const { manage, guard } = deps;
  const auth = { preHandler: guard.authenticate };
  const admin = { preHandler: guard.requireRoles('ADMIN') };
  const me = (req: FastifyRequest) => req.user!.id;
  const p = (req: FastifyRequest) => (req.params as Params).id;
  const meta = (req: FastifyRequest) => ({ ip: req.ip ?? null });

  // ── Courses ──
  app.get('/training/manage/courses', auth, async (req) => ({ data: await manage.listCourses(me(req), req.query) }));
  app.post('/training/manage/courses', auth, async (req, reply) => reply.status(201).send({ data: await manage.createCourse(me(req), req.body, meta(req)) }));
  app.get('/training/manage/courses/:id', auth, async (req) => ({ data: await manage.getCourse(me(req), p(req)) }));
  app.patch('/training/manage/courses/:id', auth, async (req) => ({ data: await manage.updateCourse(me(req), p(req), req.body, meta(req)) }));
  app.delete('/training/manage/courses/:id', auth, async (req, reply) => {
    await manage.deleteCourse(me(req), p(req), meta(req));
    return reply.status(204).send();
  });
  app.post('/training/manage/courses/:id/publish', auth, async (req) => ({ data: await manage.publish(me(req), p(req), req.body, meta(req)) }));
  app.post('/training/manage/courses/:id/unpublish', auth, async (req) => ({ data: await manage.unpublish(me(req), p(req), meta(req)) }));
  app.post('/training/manage/courses/:id/archive', auth, async (req) => ({ data: await manage.archive(me(req), p(req), meta(req)) }));

  // ── Lessons, steps, quizzes ──
  app.post('/training/manage/courses/:id/lessons', auth, async (req, reply) => reply.status(201).send({ data: await manage.addLesson(me(req), p(req), req.body, meta(req)) }));
  app.patch('/training/manage/lessons/:id', auth, async (req) => ({ data: await manage.updateLesson(me(req), p(req), req.body, meta(req)) }));
  app.delete('/training/manage/lessons/:id', auth, async (req, reply) => {
    await manage.deleteLesson(me(req), p(req), meta(req));
    return reply.status(204).send();
  });
  app.put('/training/manage/courses/:id/lesson-order', auth, async (req) => ({ data: await manage.reorderLessons(me(req), p(req), req.body, meta(req)) }));
  app.put('/training/manage/lessons/:id/steps', auth, async (req) => ({ data: await manage.saveSteps(me(req), p(req), req.body, meta(req)) }));
  app.put('/training/manage/lessons/:id/quiz', auth, async (req) => ({ data: await manage.saveQuiz(me(req), p(req), req.body, meta(req)) }));

  // ── Files (the manager is checked before the upload is read) ──
  app.post('/training/manage/courses/:id/files', auth, async (req, reply) => {
    await manage.assertManager(me(req));
    const { file, fields } = await readUpload(req);
    const kind = fields.kind ?? (req.query as { kind?: string } | undefined)?.kind;
    return reply.status(201).send({ data: await manage.uploadFile(me(req), p(req), kind, file, meta(req)) });
  });
  app.delete('/training/manage/files/:id', auth, async (req, reply) => {
    await manage.deleteFile(me(req), p(req), meta(req));
    return reply.status(204).send();
  });
  app.post('/training/manage/signatures', auth, async (req, reply) => {
    await manage.assertManager(me(req));
    const { file } = await readUpload(req);
    return reply.status(201).send({ data: await manage.uploadSignature(me(req), file, meta(req)) });
  });

  // ── Assignments and onboarding rules ──
  app.get('/training/manage/options', auth, async (req) => ({ data: await manage.options(me(req)) }));
  app.get('/training/manage/assignments', auth, async (req) => ({ data: await manage.listAssignments(me(req), req.query) }));
  app.post('/training/manage/assignments/preview', auth, async (req) => ({ data: await manage.previewAssignment(me(req), req.body) }));
  app.post('/training/manage/assignments', auth, async (req, reply) => reply.status(201).send({ data: await manage.assign(me(req), req.body, meta(req)) }));
  app.delete('/training/manage/assignments/:id', auth, async (req, reply) => {
    await manage.withdrawAssignment(me(req), p(req), meta(req));
    return reply.status(204).send();
  });
  app.get('/training/manage/rules', auth, async (req) => ({ data: await manage.listRules(me(req)) }));
  app.post('/training/manage/rules', auth, async (req, reply) => reply.status(201).send({ data: await manage.createRule(me(req), req.body, meta(req)) }));
  app.patch('/training/manage/rules/:id', auth, async (req) => ({ data: await manage.updateRule(me(req), p(req), req.body, meta(req)) }));
  app.delete('/training/manage/rules/:id', auth, async (req, reply) => {
    await manage.deleteRule(me(req), p(req), meta(req));
    return reply.status(204).send();
  });

  // ── Feedback and certificates ──
  app.get('/training/manage/feedback', auth, async (req) => ({ data: await manage.listFeedback(me(req), req.query) }));
  app.post('/training/manage/feedback/:id/answer', auth, async (req) => ({ data: await manage.answerFeedback(me(req), p(req), req.body, meta(req)) }));
  app.post('/training/manage/feedback/:id/fixed', auth, async (req) => ({ data: await manage.markFixed(me(req), p(req), meta(req)) }));
  app.get('/training/manage/certificates', auth, async (req) => ({ data: await manage.listCertificates(me(req), req.query) }));
  app.post('/training/manage/certificates/:id/revoke', auth, async (req) => ({ data: await manage.revokeCertificate(me(req), p(req), req.body, meta(req)) }));

  // ── Settings: the first-time tour per company (administrators) ──
  app.get('/training/settings', admin, async (req) => ({ data: await manage.settings(me(req)) }));
  app.put('/training/settings', admin, async (req) => ({ data: await manage.saveSettings(me(req), req.body, meta(req)) }));
}
