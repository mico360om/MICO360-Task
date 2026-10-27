import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../../lib/http-errors';
import type { AuthGuard } from '../auth/auth-guard';
import { buildInspectionPdf, inspectionPdfFileName, reportBrand } from './inspection-report-pdf';
import type { Actor, InspectionService } from './inspection-service';

export interface InspectionRouteDeps {
  service: InspectionService;
  guard: AuthGuard;
  /** The company time zone (report days and times). */
  timeZone: string;
  /** Tells a project's open pages that one of its inspections changed. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** A project picture's bytes in a form the PDF can print (null: its icon or initials are drawn). */
  projectImage?: (imageUrl: string) => Promise<Buffer | null>;
  /** Who made a report (the staff copy says so). */
  userName?: (userId: string) => Promise<string | null>;
  /** Reports per signed-in person a minute (default 20): a PDF takes real work to make. */
  pdfsPerMinute?: number;
}

const visibleBody = z.object({ visible: z.boolean() });
const answersBody = z.object({ answers: z.unknown() });
/** A finish carries up to three drawn signatures; a phone sending a whole inspection's answers at once carries long notes. */
const BIG_BODY = { bodyLimit: 4 * 1024 * 1024 };

/**
 * Inspection checklists over HTTP (staff only: a client sees a finished, shown inspection through
 * the client page's own routes). Every route needs a staff sign-in; the service decides who may do
 * what (see inspection-service).
 */
export async function registerInspectionRoutes(app: FastifyInstance, deps: InspectionRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const auth = { preHandler: guard.authenticate };
  const actor = (req: FastifyRequest): Actor => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const changed = (projectId: string, id: string) => deps.broadcast?.(projectId, 'inspection:changed', { id, projectId });
  const params = (req: FastifyRequest) => req.params as { id: string };

  // ── Forms ──────────────────────────────────────────────────────────────────────────────────
  app.get('/inspection-forms', auth, async (req) => ({ data: await service.listForms(actor(req)) }));
  app.get('/inspection-forms/:id', auth, async (req) => ({ data: await service.getForm(actor(req), params(req).id) }));
  app.post('/inspection-forms', auth, async (req, reply) => reply.status(201).send({ data: await service.createForm(actor(req), req.body ?? {}) }));
  app.put('/inspection-forms/:id', auth, async (req) => ({ data: await service.updateForm(actor(req), params(req).id, req.body ?? {}) }));
  app.delete('/inspection-forms/:id', auth, async (req, reply) => {
    await service.deleteForm(actor(req), params(req).id);
    return reply.status(204).send();
  });

  // ── A project's inspections ────────────────────────────────────────────────────────────────
  app.get('/projects/:id/inspections', auth, async (req) => ({ data: await service.listForProject(actor(req), params(req).id) }));
  app.post('/projects/:id/inspections', auth, async (req, reply) => {
    const started = await service.start(actor(req), params(req).id, req.body ?? {});
    changed(started.projectId, started.id);
    return reply.status(201).send({ data: started });
  });

  // ── One inspection ─────────────────────────────────────────────────────────────────────────
  app.get('/inspections/:id', auth, async (req) => ({ data: await service.get(actor(req), params(req).id) }));

  // Idempotent by nature: each answer is kept only if it was edited later than the stored one.
  app.put('/inspections/:id/answers', { ...auth, ...BIG_BODY }, async (req) => {
    const { answers } = answersBody.parse(req.body ?? {});
    const out = await service.answer(actor(req), params(req).id, answers);
    if (out.results.some((r) => r.status === 'applied')) changed(out.inspection.projectId, out.inspection.id);
    return { data: out };
  });

  app.post('/inspections/:id/finish', { ...auth, ...BIG_BODY }, async (req) => {
    const done = await service.finish(actor(req), params(req).id, req.body ?? {});
    changed(done.projectId, done.id);
    return { data: done };
  });
  app.post('/inspections/:id/reopen', auth, async (req) => {
    const back = await service.reopen(actor(req), params(req).id);
    changed(back.projectId, back.id);
    return { data: back };
  });
  app.post('/inspections/:id/take-over', auth, async (req) => {
    const taken = await service.takeOver(actor(req), params(req).id);
    changed(taken.projectId, taken.id);
    return { data: taken };
  });
  app.delete('/inspections/:id', auth, async (req, reply) => {
    const before = await service.get(actor(req), params(req).id);
    await service.remove(actor(req), params(req).id);
    changed(before.projectId, before.id);
    return reply.status(204).send();
  });

  app.post('/inspections/:id/follow-ups', auth, async (req) => {
    const results = await service.makeFollowUps(actor(req), params(req).id, req.body ?? {});
    const detail = await service.get(actor(req), params(req).id);
    if (results.some((r) => r.status === 'created')) {
      changed(detail.projectId, detail.id);
      // The new tasks themselves were announced to the project's boards as they were made.
    }
    return { data: results };
  });

  app.get('/tasks/:id/inspections', auth, async (req) => ({ data: await service.forTask(actor(req), params(req).id) }));

  // A PDF takes real work to make: each person gets `pdfsPerMinute` a minute. Counted here, after the
  // sign-in check, so it is per person — the rate-limit plugin runs before it and would only see the
  // address, which a whole office shares.
  const pdfLimit = deps.pdfsPerMinute ?? 20;
  const pdfsMade = new Map<string, number[]>();
  const allowPdf = (userId: string): boolean => {
    const at = Date.now();
    const recent = (pdfsMade.get(userId) ?? []).filter((t) => at - t < 60_000);
    if (recent.length >= pdfLimit) {
      pdfsMade.set(userId, recent);
      return false;
    }
    recent.push(at);
    pdfsMade.set(userId, recent);
    if (pdfsMade.size > 5000) for (const [k, v] of pdfsMade) if (!v.some((t) => at - t < 60_000)) pdfsMade.delete(k);
    return true;
  };
  app.get('/inspections/:id/report.pdf', auth, async (req, reply) => {
    const who = actor(req);
    if (!allowPdf(who.id)) throw new HttpError('Too many reports in a minute. Please wait a moment and try again.', 'RATE_LIMITED', 429);
    const r = await service.reportOf(who, params(req).id, deps.timeZone);
    const image = r.project.imageUrl && deps.projectImage ? await deps.projectImage(r.project.imageUrl).catch(() => null) : null;
    const pdf = buildInspectionPdf({
      brand: reportBrand(),
      project: { name: r.project.name, code: r.project.code, number: r.project.number, clientName: r.project.clientName, color: r.project.color, icon: r.project.icon, image },
      report: r.report,
      staff: r.staff,
      timeZone: deps.timeZone,
      generatedAt: new Date().toISOString(),
      generatedBy: (await deps.userName?.(who.id).catch(() => null)) ?? null,
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${inspectionPdfFileName(r.report.title, r.report.date)}"`)
      .send(pdf);
  });

  // ── Show to client ─────────────────────────────────────────────────────────────────────────
  // Exactly what the client would see (with the project's people's names to look for in the notes),
  // so whoever shows it checks it first.
  app.get('/inspections/:id/client-visibility/preview', auth, async (req) => ({ data: await service.clientPreview(actor(req), params(req).id, deps.timeZone) }));
  app.put('/inspections/:id/client-visibility', auth, async (req) => {
    const { visible } = visibleBody.parse(req.body ?? {});
    const out = await service.setClientVisible(actor(req), params(req).id, visible);
    return { data: out };
  });
}
