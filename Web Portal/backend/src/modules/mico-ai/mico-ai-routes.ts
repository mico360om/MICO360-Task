import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { NotFoundError } from '../../lib/http-errors';
import { XLSX_CONTENT_TYPE } from '../../lib/xlsx-writer';
import type { MicoAiService } from './mico-ai-service';
import { tableFileName, tablePdf, tableXlsx } from './mico-ai-export';

export interface MicoAiRouteDeps {
  micoAiService: MicoAiService;
  guard: AuthGuard;
}

const id = z.string().min(1).max(64);
const chatParams = z.object({ chatId: id });
const messageParams = chatParams.extend({ messageId: id });
const fileParams = messageParams.extend({ file: z.string().max(20) });
const listQuery = z.object({ q: z.string().max(200).optional() });
const createBody = z.object({ title: z.string().max(200).optional() }).default({});
const renameBody = z.object({ title: z.string().max(200) });
const askBody = z.object({ text: z.string().max(4000) });

const viewer = (req: FastifyRequest) => ({ userId: req.user!.id, roles: req.user!.roles ?? [] });

/**
 * MICO AI: a person's own chats with the assistant (private to them: anyone else's chat is 404).
 * Asking returns 202 with the question and a pending answer; the page polls the answer for its
 * progress line and stops it with /stop. An answer's tables download as .xlsx or .pdf.
 */
export async function registerMicoAiRoutes(app: FastifyInstance, deps: MicoAiRouteDeps): Promise<void> {
  const { micoAiService: svc, guard } = deps;
  const auth = { preHandler: guard.authenticate };

  app.get('/mico-ai/status', auth, async () => ({ data: await svc.status() }));

  app.get('/mico-ai/chats', auth, async (req) => {
    const { q } = listQuery.parse(req.query ?? {});
    return { data: await svc.listChats(viewer(req), { query: q }) };
  });

  app.post('/mico-ai/chats', auth, async (req, reply) => {
    const body = createBody.parse(req.body ?? {});
    return reply.status(201).send({ data: await svc.createChat(viewer(req), body) });
  });

  app.get('/mico-ai/chats/:chatId', auth, async (req) => {
    const { chatId } = chatParams.parse(req.params);
    return { data: await svc.getChat(viewer(req), chatId) };
  });

  app.patch('/mico-ai/chats/:chatId', auth, async (req) => {
    const { chatId } = chatParams.parse(req.params);
    const { title } = renameBody.parse(req.body);
    return { data: await svc.renameChat(viewer(req), chatId, title) };
  });

  app.delete('/mico-ai/chats/:chatId', auth, async (req, reply) => {
    const { chatId } = chatParams.parse(req.params);
    await svc.deleteChat(viewer(req), chatId);
    return reply.status(204).send();
  });

  app.post('/mico-ai/chats/:chatId/messages', auth, async (req, reply) => {
    const { chatId } = chatParams.parse(req.params);
    const { text } = askBody.parse(req.body);
    return reply.status(202).send({ data: await svc.ask(viewer(req), chatId, text, { ip: req.ip ?? null }) });
  });

  app.get('/mico-ai/chats/:chatId/messages/:messageId', auth, async (req) => {
    const { chatId, messageId } = messageParams.parse(req.params);
    return { data: await svc.getMessage(viewer(req), chatId, messageId) };
  });

  app.post('/mico-ai/chats/:chatId/messages/:messageId/stop', auth, async (req) => {
    const { chatId, messageId } = messageParams.parse(req.params);
    return { data: await svc.stop(viewer(req), chatId, messageId) };
  });

  // An answer's table n (1 = the first) as Excel or a branded PDF: tables/1.xlsx, tables/1.pdf.
  app.get('/mico-ai/chats/:chatId/messages/:messageId/tables/:file', auth, async (req, reply) => {
    const { chatId, messageId, file } = fileParams.parse(req.params);
    const m = /^(\d{1,2})\.(xlsx|pdf)$/.exec(file);
    if (!m) throw new NotFoundError('That download doesn’t exist.');
    const doc = await svc.table(viewer(req), chatId, messageId, Number(m[1]));
    const format = m[2] as 'xlsx' | 'pdf';
    return reply
      .header('Content-Type', format === 'xlsx' ? XLSX_CONTENT_TYPE : 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${tableFileName(doc, format)}"`)
      .header('Cache-Control', 'no-store')
      .send(format === 'xlsx' ? tableXlsx(doc) : tablePdf(doc));
  });
}
