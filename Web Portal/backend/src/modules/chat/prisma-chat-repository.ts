import type { PrismaClient } from '@prisma/client';
import type {
  Conversation,
  ConversationRepository,
  ParticipantRepository,
  MessageRepository,
  ReactionRepository,
  ChatAttachmentRepository,
  ChatMemberLookup,
} from './chat-repository';
import { sharesProjectCompanyWhere, visibleProjectWhere } from '../companies/company-access';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';

type ConvRow = { id: string; kind: string; projectId: string | null; createdAt: Date };
const toConv = (c: ConvRow): Conversation => ({ id: c.id, kind: c.kind as Conversation['kind'], projectId: c.projectId, createdAt: c.createdAt });

export function createPrismaConversationRepository(prisma: PrismaClient): ConversationRepository {
  return {
    async findById(id) {
      const c = await prisma.conversation.findUnique({ where: { id } });
      return c ? toConv(c) : null;
    },
    async findProjectConversation(projectId) {
      const c = await prisma.conversation.findFirst({ where: { kind: 'PROJECT', projectId } });
      return c ? toConv(c) : null;
    },
    async findDirectConversation(a, b) {
      const c = await prisma.conversation.findFirst({
        where: {
          kind: 'DIRECT',
          AND: [{ participants: { some: { userId: a } } }, { participants: { some: { userId: b } } }],
        },
      });
      return c ? toConv(c) : null;
    },
    async createProject(projectId) {
      return toConv(await prisma.conversation.create({ data: { kind: 'PROJECT', projectId } }));
    },
    async createDirect() {
      return toConv(await prisma.conversation.create({ data: { kind: 'DIRECT' } }));
    },
    async listByIds(ids) {
      const cs = await prisma.conversation.findMany({ where: { id: { in: ids } } });
      return cs.map(toConv);
    },
    async listProjectConversations(projectIds) {
      if (projectIds.length === 0) return [];
      const cs = await prisma.conversation.findMany({ where: { kind: 'PROJECT', projectId: { in: projectIds } } });
      return cs.map(toConv);
    },
  };
}

export function createPrismaParticipantRepository(prisma: PrismaClient): ParticipantRepository {
  return {
    async add(conversationId, userId) {
      return prisma.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: { conversationId, userId },
        update: {},
      });
    },
    async remove(conversationId, userId) {
      await prisma.conversationParticipant.deleteMany({ where: { conversationId, userId } });
    },
    async find(conversationId, userId) {
      return prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    },
    async listByConversation(conversationId) {
      return prisma.conversationParticipant.findMany({ where: { conversationId } });
    },
    async listConversationIdsForUser(userId) {
      const rows = await prisma.conversationParticipant.findMany({ where: { userId }, select: { conversationId: true } });
      return rows.map((r) => r.conversationId);
    },
    async setLastRead(conversationId, userId, at) {
      await prisma.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: { conversationId, userId, lastReadAt: at },
        update: { lastReadAt: at },
      });
    },
    async setPrefs(conversationId, userId, patch) {
      return prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId } }, data: patch });
    },
    async setLastDelivered(conversationId, userId, at) {
      // Only ever forward: a late request from an old tab can't move "delivered" back.
      await prisma.conversationParticipant.updateMany({
        where: { conversationId, userId, OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: at } }] },
        data: { lastDeliveredAt: at },
      });
    },
  };
}

export function createPrismaMessageRepository(prisma: PrismaClient): MessageRepository {
  return {
    async create(conversationId, userId, body, extra) {
      return prisma.chatMessage.create({ data: { conversationId, userId, body, replyToId: extra?.replyToId ?? null, clientId: extra?.clientId ?? null } });
    },
    async findByClientId(conversationId, userId, clientId) {
      return prisma.chatMessage.findUnique({ where: { conversationId_userId_clientId: { conversationId, userId, clientId } } });
    },
    async search(conversationIds, q, limit) {
      if (conversationIds.length === 0) return [];
      // The column's collation is case-insensitive, so "budget" also finds "Budget".
      return prisma.chatMessage.findMany({
        where: { conversationId: { in: conversationIds }, deletedAt: null, body: { contains: q } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },
    async findById(id) {
      return prisma.chatMessage.findUnique({ where: { id } });
    },
    async list(conversationId, opts) {
      return prisma.chatMessage.findMany({
        where: { conversationId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
      });
    },
    async update(id, body) {
      return prisma.chatMessage.update({ where: { id }, data: { body, editedAt: new Date() } });
    },
    async softDelete(id) {
      // The text goes with the delete — a tombstone must not keep what the author retracted.
      return prisma.chatMessage.update({ where: { id }, data: { deletedAt: new Date(), body: '' } });
    },
    async countAfter(conversationId, after, excludeUserId) {
      return prisma.chatMessage.count({
        where: {
          conversationId,
          deletedAt: null,
          userId: { not: excludeUserId },
          ...(after ? { createdAt: { gt: after } } : {}),
        },
      });
    },
    async latest(conversationId) {
      return prisma.chatMessage.findFirst({ where: { conversationId }, orderBy: { createdAt: 'desc' } });
    },
  };
}

export function createPrismaReactionRepository(prisma: PrismaClient): ReactionRepository {
  return {
    async add(messageId, userId, emoji) {
      await prisma.chatReaction.upsert({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
        create: { messageId, userId, emoji },
        update: {},
      });
    },
    async remove(messageId, userId, emoji) {
      await prisma.chatReaction.deleteMany({ where: { messageId, userId, emoji } });
    },
    async listByMessages(ids) {
      const rows = await prisma.chatReaction.findMany({ where: { messageId: { in: ids } } });
      return rows.map((r) => ({ messageId: r.messageId, userId: r.userId, emoji: r.emoji }));
    },
  };
}

export function createPrismaChatAttachmentRepository(prisma: PrismaClient): ChatAttachmentRepository {
  return {
    async create(messageId, meta) {
      return prisma.chatAttachment.create({
        data: { messageId, fileName: meta.fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, storageKey: meta.storageKey },
      });
    },
    async listByMessages(ids) {
      return prisma.chatAttachment.findMany({ where: { messageId: { in: ids } }, orderBy: { createdAt: 'asc' } });
    },
    async deleteByMessage(messageId) {
      await prisma.chatAttachment.deleteMany({ where: { messageId } });
    },
  };
}

/**
 * Chat access follows project visibility — the owner, named manager and team of a live project who
 * share one of its active companies (companies: visibleProjectWhere), plus admins (read from the
 * database, so a revoked admin role takes effect at once). Having created a project is not a way in.
 */
export function createPrismaChatMemberLookup(prisma: PrismaClient): ChatMemberLookup {
  async function isAdmin(userId: string): Promise<boolean> {
    const row = await prisma.userRole.findFirst({
      where: { userId, role: { name: 'ADMIN' }, user: { deletedAt: null, status: 'ACTIVE' } },
      select: { userId: true },
    });
    return row !== null;
  }
  return {
    async canAccessProject(projectId, userId) {
      const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
      if (!p) return false;
      const visible = await prisma.project.count({ where: { AND: [{ id: projectId }, visibleProjectWhere(userId)] } });
      if (visible > 0) return true;
      return isAdmin(userId);
    },
    async accessibleProjectIds(userId) {
      const where = (await isAdmin(userId)) ? { deletedAt: null } : visibleProjectWhere(userId);
      const rows = await prisma.project.findMany({ where, select: { id: true } });
      return rows.map((r) => r.id);
    },
    async isActiveUser(userId) {
      // 1.23: never a client account (clients have no chat).
      const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null, status: 'ACTIVE', ...STAFF_ONLY_WHERE }, select: { id: true } });
      return u !== null;
    },
    async projectMemberIds(projectId) {
      const p = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { ownerId: true, managerId: true, members: { select: { userId: true } } },
      });
      if (!p) return [];
      const ids = [p.ownerId, p.managerId, ...p.members.map((m) => m.userId)].filter((x): x is string => !!x);
      // The team who can see it now: active, and in one of its active companies.
      const active = await prisma.user.findMany({
        where: { id: { in: [...new Set(ids)] }, deletedAt: null, status: 'ACTIVE', ...sharesProjectCompanyWhere(projectId) },
        select: { id: true },
      });
      return active.map((u) => u.id);
    },
    async teamSince(userId) {
      // On the team: the owner or manager (since the project was made) or a member (since they
      // were added). Having created a project (an administrator sets them up for others) or an
      // administrator's access to every project is not being on its team.
      // companies: only projects they can see now (on the team AND in one of their active companies).
      const rows = await prisma.project.findMany({
        where: visibleProjectWhere(userId),
        select: { id: true, createdAt: true, ownerId: true, managerId: true, members: { where: { userId }, select: { addedAt: true } } },
      });
      const team = new Map<string, Date>();
      for (const p of rows) {
        const leads = p.ownerId === userId || p.managerId === userId;
        const added = p.members[0]?.addedAt;
        team.set(p.id, leads || !added ? p.createdAt : added);
      }
      return team;
    },
    async colleagues(userId, otherId) {
      // companies: administrators are everyone's colleagues; anyone else shares an active company.
      if ((await prisma.userRole.count({ where: { userId: { in: [userId, otherId] }, role: { name: 'ADMIN' } } })) > 0) return true;
      const shared = await prisma.company.count({
        where: { status: 'ACTIVE', AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }] },
      });
      return shared > 0;
    },
    async people(userIds) {
      const ids = [...new Set(userIds)];
      if (ids.length === 0) return [];
      // Whatever their status: a name shows wherever someone wrote something the reader can see.
      return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } });
    },
  };
}
