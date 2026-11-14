import { fileContentMismatchMessage, fileTooLargeMessage, fileTypeNotAllowedMessage, safeUploadName } from '../../lib/upload-safety';
import { removeStoredFile } from '../../lib/stored-files';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { MAX_MESSAGE_LENGTH, type MessageService } from './message-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { sniffMime, SNIFFABLE } from '../../lib/magic-mime';
import { ValidationError } from '../../lib/http-errors';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import { signMessageFiles, viewerOfRequest, type FileLinks, type FileViewer } from '../files/file-links';

/** A client id lets a retried send be recognised (letters, digits, - and _ only). */
const clientIdSchema = z.string().regex(/^[\w-]{1,64}$/);
const sendSchema = z.object({
  body: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  replyToId: z.string().min(1).max(64).nullable().optional(),
  clientId: clientIdSchema.optional(),
});
const prefsSchema = z.object({ favorite: z.boolean().optional(), archived: z.boolean().optional(), muted: z.boolean().optional() }).strict();
const searchQuery = z.object({ q: z.string().max(200).default(''), conversationId: z.string().min(1).optional() });
const editSchema = z.object({ body: z.string().min(1).max(MAX_MESSAGE_LENGTH) });
const directSchema = z.object({ userId: z.string().min(1) });
const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });
// Paging: an unparseable cursor or limit is a 400, not a 500.
// Review fix #20: `before` + `beforeId` (the oldest message held: its time and id) pages without skipping a
// message of the same millisecond; `before` alone (the Android app's and the extension's cursor) works as before.
const historyQuery = z
  .object({
    before: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'before must be an ISO date-time.' })
      .transform((v) => new Date(v))
      .optional(),
    beforeId: z.string().regex(/^[\w-]{1,64}$/, { message: 'beforeId must be a message id.' }).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((q) => !q.beforeId || q.before, { message: 'beforeId goes with before.', path: ['beforeId'] });

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
  /** Makes a picture smaller before it is stored (the same bytes back when it can't). */
  shrinkImage?: (content: Buffer, mimeType: string) => Promise<Buffer>;
  /** companies: the caller's project ids in a picked company (the conversation list and chat search keep only those channels). */
  accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /** companies: the request's picked company (X-Company-Id). Absent: no pick. */
  pickOf?: PickOf;
  /** 1.23.29 private file links: each file's `url` is signed for the person it is sent to. Absent: the stored address. */
  fileLinks?: FileLinks;
  /**
   * 1.23.29: one copy per connected socket, each made for its own person (realtime.broadcastPersonal) — how a
   * live message with files is sent, never one copy for the whole room. Absent: the room broadcast.
   */
  broadcastPersonal?: (audience: { projectId?: string | null; userIds?: string[] }, event: string, build: (viewer: FileViewer) => unknown) => void;
}

export async function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): Promise<void> {
  const { messageService: chat, guard } = deps;
  /**
   * companies: with a picked company, its projects' ids (the channels a list keeps); null = every
   * channel the person has. 1.22: an administrator's list (the pick named, even null) also follows
   * "Show my projects only" — the channels of the projects they own, manage or are on the team of.
   */
  async function pickedProjectIds(req: FastifyRequest): Promise<string[] | null> {
    const pick = await (deps.pickOf ?? NO_PICK)(req);
    const roles = req.user!.roles ?? [];
    if ((!pick && !roles.includes('ADMIN')) || !deps.accessibleProjectIds) return null;
    return (await deps.accessibleProjectIds(req.user!.id, roles, pick)) ?? null;
  }

  /** 1.23.29: a message as this request's person may open its files (each link signed for them). */
  const signed = <M extends { attachments?: { storageKey: string; url: string }[] }>(req: FastifyRequest, message: M): M =>
    signMessageFiles(deps.fileLinks, message, viewerOfRequest(req));

  /**
   * Deliver a chat event to a project channel's room, or to each participant of a DM. Live updates are best
   * effort (review I1): what was saved is answered as saved; open screens catch up on their next read.
   */
  async function announce(conversationId: string, event: string, payload: unknown): Promise<void> {
    let t: Awaited<ReturnType<MessageService['conversationTargets']>>;
    try {
      t = await chat.conversationTargets(conversationId);
    } catch {
      return;
    }
    if (t.kind === 'PROJECT' && t.projectId) {
      deps.broadcastToProject?.(t.projectId, event, payload);
    } else if (t.kind === 'DIRECT') {
      for (const uid of t.userIds) deps.broadcastToUser?.(uid, event, payload);
    }
  }

  /**
   * 1.23.29 Private file links (design §7.4): a new message with files goes to each connected person with
   * its links signed for them — the same people as the room broadcast (the channel's room, or each person of
   * a direct chat). A message without files keeps the one room broadcast.
   */
  async function announceMessage(conversationId: string, message: { attachments?: { storageKey: string; url: string }[] }): Promise<void> {
    const links = deps.fileLinks;
    const personal = deps.broadcastPersonal;
    if (!links || !personal || !message.attachments || message.attachments.length === 0) {
      await announce(conversationId, 'chat:message', { conversationId, message });
      return;
    }
    // Best effort, as announce (1.23.28 review I1): a saved message is answered as saved whatever happens here.
    let t: Awaited<ReturnType<MessageService['conversationTargets']>>;
    try {
      t = await chat.conversationTargets(conversationId);
    } catch {
      return;
    }
    const audience = t.kind === 'PROJECT' && t.projectId ? { projectId: t.projectId } : t.kind === 'DIRECT' ? { userIds: t.userIds } : null;
    if (audience) personal(audience, 'chat:message', (viewer) => ({ conversationId, message: signMessageFiles(links, message, viewer) }));
  }

  // The signed-in user's conversation inbox (project channels + DMs) with unread counts.
  app.get('/conversations', { preHandler: guard.authenticate }, async (req) => ({
    data: await chat.listConversations(req.user!.id, { onlyProjectIds: await pickedProjectIds(req) }),
  }));

  // Get-or-create a project's team channel and return its recent messages.
  app.get('/projects/:id/chat', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const conversation = await chat.getOrCreateProjectConversation(id, req.user!.id);
    const { messages, authors } = await chat.listMessages(conversation.id, req.user!.id, {});
    return { data: { conversation, messages: messages.map((m) => signed(req, m)), authors } };
  });

  // Get-or-create a 1:1 direct conversation with another user (companies: a new one only with a
  // colleague; an existing one comes back, with `readOnly` when they no longer share a company).
  app.post('/conversations/direct', { preHandler: guard.authenticate }, async (req, reply) => {
    const { userId } = directSchema.parse(req.body);
    const conversation = await chat.getOrCreateDirectConversation(req.user!.id, userId);
    return reply.status(201).send({ data: conversation });
  });

  // Paginated message history (newest loaded, older via ?before=<ISO>&beforeId=<id of the oldest held>).
  app.get('/conversations/:id/messages', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const { before, beforeId, limit } = historyQuery.parse(req.query);
    const { messages, authors } = await chat.listMessages(id, req.user!.id, { before, beforeId, limit });
    // companies: `authors` names everyone on the page, also people the reader doesn't otherwise know.
    return { data: messages.map((m) => signed(req, m)), authors };
  });

  // Send. A retry with the same clientId gets the first message back (200) — never a duplicate.
  app.post('/conversations/:id/messages', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { body, replyToId, clientId } = sendSchema.parse(req.body);
    const { message, created } = await chat.postMessage(id, req.user!.id, { body, replyToId, clientId });
    if (!created) return reply.status(200).send({ data: signed(req, message) });
    await announceMessage(id, message);
    return reply.status(201).send({ data: signed(req, message) });
  });

  // The caller's own settings for a conversation: favorite, archived, muted.
  app.put('/conversations/:id/prefs', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const prefs = await chat.setPreferences(id, req.user!.id, prefsSchema.parse(req.body ?? {}));
    // The caller's other tabs and phone: a muted or archived conversation leaves their Chat badge.
    deps.broadcastToUser?.(req.user!.id, 'chat:prefs', { conversationId: id, prefs });
    return { data: prefs };
  });

  // The caller's app has received this conversation's messages: the senders see "delivered".
  app.post('/conversations/:id/delivered', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await chat.markDelivered(id, req.user!.id);
    await announce(id, 'chat:delivered', { conversationId: id, userId: req.user!.id, at: new Date().toISOString() });
    return reply.status(204).send();
  });

  // Who is in the conversation (user ids): a channel's project people, or a DM's two people.
  app.get('/conversations/:id/members', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await chat.listMembers(id, req.user!.id) };
  });

  // Search message text in all of the caller's conversations, or in one of them.
  app.get('/chat/search', { preHandler: guard.authenticate }, async (req) => {
    const { q, conversationId } = searchQuery.parse(req.query);
    // companies: searching everywhere follows the pick; one named conversation is checked by its own rule.
    return { data: await chat.searchMessages(req.user!.id, q, { conversationId, ...(conversationId ? {} : { onlyProjectIds: await pickedProjectIds(req) }) }) };
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
    const field = (name: string): string | undefined => {
      const f = file.fields?.[name];
      return f && !Array.isArray(f) && 'value' in f && typeof f.value === 'string' ? f.value : undefined;
    };
    const clientIdRaw = field('clientId');
    const clientId = clientIdRaw !== undefined ? clientIdSchema.parse(clientIdRaw) : undefined;
    const replyToId = field('replyToId') || undefined;
    // A retried upload: the first one already arrived — answer with it, store nothing again.
    if (clientId) {
      const earlier = await chat.findSent(id, req.user!.id, clientId);
      if (earlier) return reply.status(200).send({ data: signed(req, earlier) });
    }
    const content = await file.toBuffer();
    if (content.length === 0) throw new ValidationError('File is empty.');
    const max = deps.attachmentMaxSizeBytes ?? 10 * 1024 * 1024;
    if (content.length > max) throw new ValidationError(fileTooLargeMessage(max));
    const allowed = deps.attachmentAllowedMime ?? [];
    if (allowed.length > 0 && !allowed.includes(file.mimetype)) throw new ValidationError(fileTypeNotAllowedMessage(file.filename));
    if (SNIFFABLE.has(file.mimetype)) {
      const actual = sniffMime(content);
      if (actual !== file.mimetype) throw new ValidationError(fileContentMismatchMessage(file.filename));
    }
    const captionField = file.fields?.body;
    const caption = captionField && !Array.isArray(captionField) && 'value' in captionField && typeof captionField.value === 'string' ? captionField.value : '';
    if (caption.trim().length > MAX_MESSAGE_LENGTH) throw new ValidationError(`A caption can be at most ${MAX_MESSAGE_LENGTH} characters.`);
    // Pictures are stored smaller (only once every check above has passed).
    const kept = deps.shrinkImage ? await deps.shrinkImage(content, file.mimetype) : content;
    // N6: the name as kept and shown (no hidden or right-to-left characters, fits its column, never empty).
    const fileName = safeUploadName(file.filename, file.mimetype);
    const stored = await storage.save({ filename: fileName, mimeType: file.mimetype, content: kept });
    // A file this request stored but no message keeps: removed (tried again, else logged — never left quietly).
    const dropStored = () => removeStoredFile(storage, stored.storageKey, { logger: { warn: (m, c) => req.log.warn(c ?? {}, m) }, what: 'an unused chat upload' });
    let result;
    try {
      result = await chat.postMessage(id, req.user!.id, {
        body: caption,
        replyToId,
        clientId,
        attachment: { fileName, mimeType: file.mimetype, sizeBytes: stored.sizeBytes, storageKey: stored.storageKey },
      });
    } catch (err) {
      // No message, no file (#18: the two are saved together): don't leave an orphan upload behind — unless a
      // saved record uses it (review I1: on any doubt, the file is kept).
      const kept = await chat.fileInUse(stored.storageKey).catch(() => true);
      if (!kept) await dropStored();
      throw err;
    }
    if (!result.created) {
      // Two copies of the same upload raced: keep the first, drop this file (never one the kept message uses).
      if (!result.message.attachments.some((a) => a.storageKey === stored.storageKey)) await dropStored();
      return reply.status(200).send({ data: signed(req, result.message) });
    }
    await announceMessage(id, result.message);
    return reply.status(201).send({ data: signed(req, result.message) });
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
