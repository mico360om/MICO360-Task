import { Prisma, type PrismaClient } from '@prisma/client';
import { snippetOf, type ChatMatch, type MessageRecord, type MessageRole, type MessageStatus, type MicoAiRepository } from './mico-ai-repository';

/**
 * MICO AI's chats in mico_ai_chats / mico_ai_messages. Every chat lookup is filtered by its owner
 * (`userId`), so a chat is never found for anyone else. Messages are deleted with their chat.
 */
export function createPrismaMicoAiRepository(prisma: PrismaClient): MicoAiRepository {
  // A strictly increasing clock, so a question and its answer stored in the same millisecond keep their order.
  let last = 0;
  const tick = () => {
    last = Math.max(last + 1, Date.now());
    return new Date(last);
  };
  const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));
  const toMessage = (m: {
    id: string;
    chatId: string;
    role: string;
    text: string;
    content: Prisma.JsonValue | null;
    status: string;
    step: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): MessageRecord => ({ ...m, role: m.role as MessageRole, status: m.status as MessageStatus, content: m.content ?? null });
  const order = [{ lastMessageAt: 'desc' as const }, { createdAt: 'desc' as const }];

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
    async setSummary(chatId, summary, summarizedCount) {
      await prisma.micoAiChat.updateMany({ where: { id: chatId }, data: { summary, summarizedCount } });
    },
    async listMessages(chatId) {
      return (await prisma.micoAiMessage.findMany({ where: { chatId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(toMessage);
    },
    async addMessage(chatId, m) {
      const at = tick();
      const [row] = await prisma.$transaction([
        prisma.micoAiMessage.create({ data: { chatId, role: m.role, text: m.text, content: json(m.content), status: m.status, step: m.step ?? null, createdAt: at } }),
        prisma.micoAiChat.update({ where: { id: chatId }, data: { lastMessageAt: at } }),
      ]);
      return toMessage(row);
    },
    async getMessage(chatId, messageId) {
      const m = await prisma.micoAiMessage.findFirst({ where: { id: messageId, chatId } });
      return m ? toMessage(m) : null;
    },
    async updateMessage(messageId, patch, onlyIf) {
      const data: Prisma.MicoAiMessageUpdateManyMutationInput = {};
      if (patch.text !== undefined) data.text = patch.text;
      if (patch.content !== undefined) data.content = json(patch.content);
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.step !== undefined) data.step = patch.step === null ? null : patch.step.slice(0, 200);
      const { count } = await prisma.micoAiMessage.updateMany({ where: { id: messageId, ...(onlyIf ? { status: onlyIf } : {}) }, data });
      return count > 0;
    },
  };
}

