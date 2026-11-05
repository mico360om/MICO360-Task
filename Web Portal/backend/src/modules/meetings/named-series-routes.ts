import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { SERIES_NAME_MAX } from './named-series';
import type { NamedSeriesService } from './named-series-service';

/**
 * 1.23 Meeting series over HTTP (staff routes; every one is an object check — route-classes.ts):
 *   GET    /meetings/:id/series            the meeting page's series line, list and "Open from earlier meetings"
 *   GET    /meetings/:id/series-options    "Add to a series": the series of its project (company)
 *   POST   /meeting-series                 "New series…" with a meeting (and its repeats)
 *   GET    /meeting-series/:id             the Series page
 *   PATCH  /meeting-series/:id             rename
 *   DELETE /meeting-series/:id             delete (its meetings stay)
 *   POST   /meeting-series/:id/meetings    add existing meetings
 *   DELETE /meeting-series/:id/meetings/:meetingId   take one out (a repeat: its family)
 *   POST   /meeting-series/:id/merge       merge another series into this one
 *   GET    /meeting-series/:id/candidates  the "Add existing meetings" picker
 *   GET    /meeting-series/:id/prefill     "New meeting in this series": the form's starting values
 * A series someone may not see answers 404, as a meeting they may not open does.
 */
export interface NamedSeriesRouteDeps {
  service: NamedSeriesService;
  guard: AuthGuard;
}

const id = z.string().min(1).max(64);
const name = z.string().max(SERIES_NAME_MAX + 50);
const createBody = z.object({ name, meetingId: id, wholeFamily: z.boolean().optional() });
const renameBody = z.object({ name });
const addBody = z.object({ meetingIds: z.array(id).min(1).max(50), wholeFamily: z.boolean().optional() });
const mergeBody = z.object({ seriesId: id });
const params = z.object({ id });
const memberParams = z.object({ id, meetingId: id });

export async function registerNamedSeriesRoutes(app: FastifyInstance, deps: NamedSeriesRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const viewer = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  app.get('/meetings/:id/series', { preHandler: guard.authenticate }, async (req) => {
    const { id: meetingId } = params.parse(req.params);
    return { data: await service.context(viewer(req), meetingId) };
  });

  app.get('/meetings/:id/series-options', { preHandler: guard.authenticate }, async (req) => {
    const { id: meetingId } = params.parse(req.params);
    return { data: await service.options(viewer(req), meetingId) };
  });

  app.post('/meeting-series', { preHandler: guard.authenticate }, async (req, reply) => {
    const body = createBody.parse(req.body);
    return reply.status(201).send({ data: await service.create(viewer(req), body) });
  });

  app.get('/meeting-series/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id: seriesId } = params.parse(req.params);
    return { data: await service.page(viewer(req), seriesId) };
  });

  app.patch('/meeting-series/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id: seriesId } = params.parse(req.params);
    return { data: await service.rename(viewer(req), seriesId, renameBody.parse(req.body).name) };
  });

  app.delete('/meeting-series/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id: seriesId } = params.parse(req.params);
    await service.remove(viewer(req), seriesId);
    return reply.status(204).send();
  });

  app.post('/meeting-series/:id/meetings', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id: seriesId } = params.parse(req.params);
    const body = addBody.parse(req.body);
    await service.addMeetings(viewer(req), seriesId, body.meetingIds, { wholeFamily: body.wholeFamily });
    return reply.status(204).send();
  });

  app.delete('/meeting-series/:id/meetings/:meetingId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id: seriesId, meetingId } = memberParams.parse(req.params);
    await service.removeMeeting(viewer(req), seriesId, meetingId);
    return reply.status(204).send();
  });

  app.post('/meeting-series/:id/merge', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id: seriesId } = params.parse(req.params);
    await service.merge(viewer(req), seriesId, mergeBody.parse(req.body).seriesId);
    return reply.status(204).send();
  });

  app.get('/meeting-series/:id/candidates', { preHandler: guard.authenticate }, async (req) => {
    const { id: seriesId } = params.parse(req.params);
    return { data: await service.candidates(viewer(req), seriesId) };
  });

  app.get('/meeting-series/:id/prefill', { preHandler: guard.authenticate }, async (req) => {
    const { id: seriesId } = params.parse(req.params);
    return { data: await service.prefill(viewer(req), seriesId) };
  });
}
