import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { MAX_MESSAGE_LENGTH, type MessageService } from './message-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { sniffMime, SNIFFABLE } from '../../lib/magic-mime';
import { ValidationError } from '../../lib/http-errors';

const sendSchema = z.object({ body: z.string().min(1).max(MAX_MESSAGE_LENGTH) });
const editSchema = z.object({ body: z.string().min(1).max(MAX_MESSAGE_LENGTH) });
const directSchema = z.object({ userId: z.string().min(1) });
const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });
// Paging: an unparseable cursor or limit is a 400, not a 500.
const historyQuery = z.object({
  before: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'before must be an ISO date-time.' })
    .transform((v) => new Date(v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export interface ChatRouteDeps {
  messageService: MessageService;
  guard: AuthGuard;
  /** Broadcast to everyone viewing a project (its channel). */
  broadcastToProject?: (projectId: string, event: string, payload: unknown) => void;
  /** Broadcast to a single user across their devices (their DMs). */
  broadcastToUser?: (userId: string, event: string, payload: unknown) => void;
  /** File storage for chat attachments; when absent, the attachment endpoint is disabled. */
  storage?: AttachmentStorage;
  attachmentMaxSizeBytes?: number;
  /** Allowed mime types; empty/undefined means allow any. */
  attachmentAllowedMime?: string[];
}

export async function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): Promise<void> {
  const { messageService: chat, guard } = deps;

  /** Deliver a chat event to a project channel's room, or to each participant of a DM. */
  async function announce(conversationId: string, event: string, payload: unknown): Promise<void> {
    const t = await chat.conversationTargets(conversationId);
    if (t.kind === 'PROJECT' && t.projectId) {
      deps.broadcastToProject?.(t.projectId, event, payload);
    } else if (t.kind === 'DIRECT') {
      for (const uid of t.userIds) deps.broadcastToUser?.(uid, event, payload);
    }
  }

  // The signed-in user's conversation inbox (project channels + DMs) with unread counts.
  app.get('/conversations', { preHandler: guard.authenticate }, async (req) => ({
    data: await chat.listConversations(req.user!.id),
  }));

  // Get-or-create a project's team channel and return its recent messages.
  app.get('/projects/:id/chat', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const conversation = await chat.getOrCreateProjectConversation(id, req.user!.id);
    const { messages } = await chat.listMessages(conversation.id, req.user!.id, {});
    return { data: { conversation, messages } };
  });

  // Get-or-create a 1:1 direct conversation with another user.
  app.post('/conversations/direct', { preHandler: guard.authenticate }, async (req, reply) => {
    const { userId } = directSchema.parse(req.body);
    const conversation = await chat.getOrCreateDirectConversation(req.user!.id, userId);
    return reply.status(201).send({ data: conversation });
  });

  // Paginated message history (newest loaded, older via ?before=<ISO>).
  app.get('/conversations/:id/messages', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const { before, limit } = historyQuery.parse(req.query);
    const { messages } = await chat.listMessages(id, req.user!.id, { before, limit });
    return { data: messages };
  });

  app.post('/conversations/:id/messages', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { body } = sendSchema.parse(req.body);
    const message = await chat.sendMessage(id, req.user!.id, body);
    await announce(id, 'chat:message', { conversationId: id, message });
    return reply.status(201).send({ data: message });
  });

  app.post('/conversations/:id/read', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await chat.markRead(id, req.user!.id);
    // Tell the other participant(s) so read receipts ("seen") update live for the message sender.
    await announce(id, 'chat:read', { conversationId: id, userId: req.user!.id, at: new Date().toISOString() });
    return reply.status(204).send();
  });

  // Upload a file as a message attachment (multipart). Optional text caption in a `body` field.
  app.post('/conversations/:id/attachments', { preHandler: guard.authenticate }, async (req, reply) => {
    if (!deps.storage) throw new ValidationError('Attachments are not enabled.');
    const storage = deps.storage;
    const { id } = req.params as { id: string };
    // Access first: an unknown or forbidden conversation must never cost a file on disk.
    await chat.assertCanPost(id, req.user!.id);
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded.');
    const content = await file.toBuffer();
    if (content.length === 0) throw new ValidationError('File is empty.');
    const max = deps.attachmentMaxSizeBytes ?? 10 * 1024 * 1024;
    if (content.length > max) throw new ValidationError(`File exceeds the ${max}-byte limit.`);
    const allowed = deps.attachmentAllowedMime ?? [];
    if (allowed.length > 0 && !allowed.includes(file.mimetype)) throw new ValidationError(`File type ${file.mimetype} is not allowed.`);
    if (SNIFFABLE.has(file.mimetype)) {
      const actual = sniffMime(content);
      if (actual !== file.mimetype) throw new ValidationError(`File content does not match its declared type (${file.mimetype}).`);
    }
    const captionField = file.fields?.body;
    const caption = captionField && !Array.isArray(captionField) && 'value' in captionField && typeof captionField.value === 'string' ? captionField.value : '';
    if (caption.trim().length > MAX_MESSAGE_LENGTH) throw new ValidationError(`A caption can be at most ${MAX_MESSAGE_LENGTH} characters.`);
    const stored = await storage.save({ filename: file.filename, mimeType: file.mimetype, content });
    let message;
    try {
      message = await chat.sendMessage(id, req.user!.id, caption, {
        fileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
      });
    } catch (err) {
      // No message, no file: don't leave an orphan upload behind.
      await storage.remove(stored.storageKey).catch(() => {});
      throw err;
    }
    await announce(id, 'chat:message', { conversationId: id, message });
    return reply.status(201).send({ data: message });
  });

  app.patch('/messages/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const { body } = editSchema.parse(req.body);
    const message = await chat.editMessage(id, req.user!.id, body);
    await announce(message.conversationId, 'chat:message:edited', { conversationId: message.conversationId, message });
    return { data: message };
  });

  app.delete('/messages/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const isAdmin = (req.user!.roles ?? []).includes('ADMIN');
    const message = await chat.deleteMessage(id, req.user!.id, isAdmin);
    await announce(message.conversationId, 'chat:message:deleted', { conversationId: message.conversationId, id });
    return reply.status(204).send();
  });

  app.post('/messages/:id/reactions', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { emoji } = reactionSchema.parse(req.body);
    const { conversationId } = await chat.addReaction(id, req.user!.id, emoji);
    await announce(conversationId, 'chat:reaction', { conversationId, messageId: id, userId: req.user!.id, emoji, op: 'add' });
    return reply.status(201).send({ data: { ok: true } });
  });

  app.delete('/messages/:id/reactions/:emoji', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, emoji } = req.params as { id: string; emoji: string };
    const { conversationId } = await chat.removeReaction(id, req.user!.id, decodeURIComponent(emoji));
    await announce(conversationId, 'chat:reaction', { conversationId, messageId: id, userId: req.user!.id, emoji, op: 'remove' });
    return reply.status(204).send();
  });
}
