import { Prisma, type PrismaClient } from '@prisma/client';
import { snippetOf, type ChatMatch, type MessageRecord, type MessageRole, type MessageStatus, type MessageWithResults, type MicoAiRepository, type ProposalPatch } from './mico-ai-repository';
import type { ItemResult, ItemUndo, ProposalItem, ProposalRecord, ProposalStatus } from './mico-ai-actions-types';

/**
 * MICO AI's chats in mico_ai_chats / mico_ai_messages. Every chat lookup is filtered by its owner
 * (`userId`), so a chat is never found for anyone else. Messages are deleted with their chat. An
 * answer's tool results live in their own column, read only for a new question's context.
 */
export function createPrismaMicoAiRepository(prisma: PrismaClient): MicoAiRepository {
  // A strictly increasing clock, so a question and its answer stored in the same millisecond keep their order.
  let last = 0;
  const tick = () => {
    last = Math.max(last + 1, Date.now());
    return new Date(last);
  };
  const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));
  /** Every column but the stored results. */
  const lean = { id: true, chatId: true, role: true, text: true, content: true, status: true, step: true, createdAt: true, updatedAt: true } as const;
  type LeanRow = { id: string; chatId: string; role: string; text: string; content: Prisma.JsonValue | null; status: string; step: string | null; createdAt: Date; updatedAt: Date };
  const toMessage = (m: LeanRow): MessageRecord => ({
    id: m.id,
    chatId: m.chatId,
    role: m.role as MessageRole,
    text: m.text,
    content: m.content ?? null,
    status: m.status as MessageStatus,
    step: m.step,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  });
  type ProposalRow = Prisma.MicoAiProposalGetPayload<object>;
  const toProposal = (p: ProposalRow): ProposalRecord => ({
    id: p.id,
    messageId: p.messageId,
    userId: p.userId,
    status: p.status as ProposalStatus,
    items: (Array.isArray(p.items) ? p.items : []) as unknown as ProposalItem[],
    note: p.note,
    sendInvites: p.sendInvites,
    results: (p.results ?? null) as unknown as Record<string, ItemResult> | null,
    undo: (p.undo ?? null) as unknown as Record<string, ItemUndo> | null,
    confirmedAt: p.confirmedAt,
    undoUntil: p.undoUntil,
    undoneAt: p.undoneAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  });
  const proposalData = (patch: ProposalPatch): Prisma.MicoAiProposalUpdateManyMutationInput => {
    const data: Prisma.MicoAiProposalUpdateManyMutationInput = {};
    if (patch.items !== undefined) data.items = patch.items as unknown as Prisma.InputJsonValue;
    if (patch.sendInvites !== undefined) data.sendInvites = patch.sendInvites;
    if (patch.results !== undefined) data.results = json(patch.results);
    if (patch.undo !== undefined) data.undo = json(patch.undo);
    if (patch.confirmedAt !== undefined) data.confirmedAt = patch.confirmedAt;
    if (patch.undoUntil !== undefined) data.undoUntil = patch.undoUntil;
    if (patch.undoneAt !== undefined) data.undoneAt = patch.undoneAt;
    return data;
  };
  const order = [{ lastMessageAt: 'desc' as const }, { createdAt: 'desc' as const }];
  const oldestFirst = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
  const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

  return {
    async listChats(userId, { query, limit }) {
      const q = query?.trim();
      if (!q) return (await prisma.micoAiChat.findMany({ where: { userId }, orderBy: order, take: limit })).map((chat) => ({ chat, snippet: null }));
      const [byTitle, hits] = await Promise.all([
        prisma.micoAiChat.findMany({ where: { userId, title: { contains: q } }, orderBy: order, take: limit }),
        prisma.micoAiMessage.findMany({ where: { text: { contains: q }, chat: { userId } }, select: { chatId: true, text: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
      ]);
      const seen = new Set(byTitle.map((c) => c.id));
      const snippets = new Map<string, string>();
      for (const h of hits) if (!seen.has(h.chatId) && !snippets.has(h.chatId)) snippets.set(h.chatId, snippetOf(h.text, q));
      const more = snippets.size ? await prisma.micoAiChat.findMany({ where: { userId, id: { in: [...snippets.keys()] } } }) : [];
      const all: ChatMatch[] = [...byTitle.map((chat) => ({ chat, snippet: null })), ...more.map((chat) => ({ chat, snippet: snippets.get(chat.id) ?? null }))];
      return all.sort((a, b) => b.chat.lastMessageAt.getTime() - a.chat.lastMessageAt.getTime() || b.chat.createdAt.getTime() - a.chat.createdAt.getTime()).slice(0, limit);
    },
    async createChat(userId, title) {
      const at = tick();
      return prisma.micoAiChat.create({ data: { userId, title, createdAt: at, lastMessageAt: at } });
    },
    async getChat(userId, chatId) {
      return prisma.micoAiChat.findFirst({ where: { id: chatId, userId } });
    },
    async renameChat(userId, chatId, title) {
      const { count } = await prisma.micoAiChat.updateMany({ where: { id: chatId, userId }, data: { title } });
      return count ? prisma.micoAiChat.findFirst({ where: { id: chatId, userId } }) : null;
    },
    async deleteChat(userId, chatId) {
      const { count } = await prisma.micoAiChat.deleteMany({ where: { id: chatId, userId } });
      return count > 0;
    },
    async deleteAllForUser(userId) {
      const { count } = await prisma.micoAiChat.deleteMany({ where: { userId } });
      return count;
    },
    async setSummary(chatId, summary, summarizedCount) {
      await prisma.micoAiChat.updateMany({ where: { id: chatId }, data: { summary, summarizedCount } });
    },
    async countMessages(chatId) {
      return prisma.micoAiMessage.count({ where: { chatId } });
    },
    async pageMessages(chatId, { limit, before }) {
      let where: Prisma.MicoAiMessageWhereInput = { chatId };
      if (before) {
        const cursor = await prisma.micoAiMessage.findFirst({ where: { id: before, chatId }, select: { createdAt: true, id: true } });
        if (!cursor) return { messages: [], hasMore: false };
        where = { chatId, OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
      }
      const rows = await prisma.micoAiMessage.findMany({ where, orderBy: newestFirst, take: limit + 1, select: lean });
      return { messages: rows.slice(0, limit).reverse().map(toMessage), hasMore: rows.length > limit };
    },
    async recentMessages(chatId, limit) {
      const rows = await prisma.micoAiMessage.findMany({ where: { chatId }, orderBy: newestFirst, take: limit });
      return rows.reverse().map((m): MessageWithResults => ({ ...toMessage(m), results: m.results ?? null }));
    },
    async messageRange(chatId, offset, limit) {
      if (limit <= 0) return [];
      return (await prisma.micoAiMessage.findMany({ where: { chatId }, orderBy: oldestFirst, skip: offset, take: limit, select: lean })).map(toMessage);
    },
    async getMessage(chatId, messageId) {
      const m = await prisma.micoAiMessage.findFirst({ where: { id: messageId, chatId }, select: lean });
      return m ? toMessage(m) : null;
    },
    async questionBefore(chatId, messageId) {
      const m = await prisma.micoAiMessage.findFirst({ where: { id: messageId, chatId }, select: { createdAt: true, id: true } });
      if (!m) return null;
      const q = await prisma.micoAiMessage.findFirst({
        where: { chatId, role: 'user', OR: [{ createdAt: { lt: m.createdAt } }, { createdAt: m.createdAt, id: { lt: m.id } }] },
        orderBy: newestFirst,
        select: { text: true },
      });
      return q?.text ?? null;
    },
    // The chat's row is locked for the turn: a second question for the same chat waits, then sees the first one's pending answer.
    async startTurn(chatId, turn) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM mico_ai_chats WHERE id = ${chatId} FOR UPDATE`;
        await tx.micoAiMessage.updateMany({ where: { chatId, status: 'PENDING', updatedAt: { lt: turn.staleBefore } }, data: { status: 'ERROR', content: json(turn.interrupted), step: null } });
        const pending = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM mico_ai_messages WHERE chatId = ${chatId} AND status = 'PENDING' FOR UPDATE`;
        if (Number(pending[0]?.n ?? 0) > 0) return 'busy' as const;
        const asked = tick();
        const answering = tick();
        const question = await tx.micoAiMessage.create({ data: { chatId, role: 'user', text: turn.question, content: Prisma.DbNull, status: 'DONE', createdAt: asked }, select: lean });
        const answer = await tx.micoAiMessage.create({ data: { chatId, role: 'assistant', text: '', content: Prisma.DbNull, status: 'PENDING', step: turn.step, createdAt: answering }, select: lean });
        await tx.micoAiChat.update({ where: { id: chatId }, data: { lastMessageAt: answering } });
        return { question: toMessage(question), answer: toMessage(answer) };
      });
    },
    async addMessage(chatId, m) {
      const at = tick();
      const [row] = await prisma.$transaction([
        prisma.micoAiMessage.create({ data: { chatId, role: m.role, text: m.text, content: json(m.content), status: m.status, step: m.step ?? null, createdAt: at }, select: lean }),
        prisma.micoAiChat.update({ where: { id: chatId }, data: { lastMessageAt: at } }),
      ]);
      return toMessage(row);
    },
    async updateMessage(messageId, patch, onlyIf) {
      const data: Prisma.MicoAiMessageUpdateManyMutationInput = {};
      if (patch.text !== undefined) data.text = patch.text;
      if (patch.content !== undefined) data.content = json(patch.content);
      if (patch.results !== undefined) data.results = json(patch.results);
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.step !== undefined) data.step = patch.step === null ? null : patch.step.slice(0, 200);
      const { count } = await prisma.micoAiMessage.updateMany({ where: { id: messageId, ...(onlyIf ? { status: onlyIf } : {}) }, data });
      return count > 0;
    },
    async interruptStale(before, content, chatId) {
      const { count } = await prisma.micoAiMessage.updateMany({
        where: { status: 'PENDING', updatedAt: { lt: before }, ...(chatId ? { chatId } : {}) },
        data: { status: 'ERROR', content: json(content), step: null },
      });
      return count;
    },
    async createProposal(input) {
      const row = await prisma.micoAiProposal.create({
        data: { messageId: input.messageId, userId: input.userId, items: input.items as unknown as Prisma.InputJsonValue, note: input.note ? input.note.slice(0, 300) : null },
      });
      return toProposal(row);
    },
    async getProposal(messageId) {
      const row = await prisma.micoAiProposal.findUnique({ where: { messageId } });
      return row ? toProposal(row) : null;
    },
    async proposalsFor(messageIds) {
      if (messageIds.length === 0) return [];
      return (await prisma.micoAiProposal.findMany({ where: { messageId: { in: messageIds } } })).map(toProposal);
    },
    // One conditional statement: of two requests at the same moment, only one finds it still in `from`.
    async moveProposal(id, from, to, patch = {}) {
      const { count } = await prisma.micoAiProposal.updateMany({ where: { id, status: { in: from } }, data: { ...proposalData(patch), status: to } });
      return count > 0;
    },
    async updateProposal(id, patch, onlyIf) {
      const { count } = await prisma.micoAiProposal.updateMany({ where: { id, ...(onlyIf ? { status: onlyIf } : {}) }, data: proposalData(patch) });
      return count > 0;
    },
  };
}
