import { stat } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { newFormKey, parseUploadKey, refiledKey, uploadUrlOf, type UploadType } from './upload-paths';
import { PROJECT_COMPANY_SELECT, projectCompanyOf } from './upload-places';
import { pathInside, type AliasRow, type MoveArea, type MoveRowRef, type MoveStore, type PlannedMove } from './upload-move';
import { storedKeyOf } from '../../lib/stored-files';

/**
 * 1.23.38 Upload folders: the database side of the move (upload-move.ts). Which files are not in their
 * folder yet — a 1.23.31 plain name, or a folder whose company is no longer one of its project's companies
 * (a project that moved: re-filed) — and how their rows are pointed at the new key. Every update is
 * conditional on the old key, so a row changed or deleted meanwhile is left alone.
 *
 * Rows: task, chat, meeting-note and decision attachments and Learning Hub files (storageKey), and the
 * `/uploads/<key>` addresses of profile photos, project pictures and company logos.
 */

type ProjectCompanies = { mainCompanyId: string | null; companies: { companyId: string }[] };

interface Candidate {
  area: MoveArea;
  key: string;
  ref: MoveRowRef;
  type: UploadType;
  /** The company the file should be under (null: shared). */
  want: string | null;
  /** Companies a folder may name and stay (the project's companies); empty: only `want`. */
  allowed: string[];
  userId: string | null;
  at: Date | null;
  mimeType: string | null;
}

const companiesOf = (p: ProjectCompanies | null | undefined): string[] => (p ? [...new Set([p.mainCompanyId, ...p.companies.map((c) => c.companyId)].filter((x): x is string => !!x))] : []);

/** The key a file should have now, or null when it is in its folder already (or can't be placed). */
export function wantedKey(c: Pick<Candidate, 'key' | 'type' | 'want' | 'allowed' | 'userId' | 'at' | 'mimeType'>): string | null {
  const parsed = parseUploadKey(c.key);
  if (parsed && !parsed.legacy) {
    const ok = parsed.companyId === null ? c.want === null : parsed.companyId === c.want || c.allowed.includes(parsed.companyId);
    return ok ? null : refiledKey(c.key, c.want);
  }
  try {
    return newFormKey(c.key, { companyId: c.want, userId: c.userId, type: c.type, at: c.at ?? new Date(), mimeType: c.mimeType });
  } catch {
    return null;
  }
}

export function createPrismaMoveStore(prisma: PrismaClient, dirs: Record<MoveArea, string>, now: () => Date = () => new Date()): MoveStore {
  /** The file's last change on disk: the month folder of a picture whose upload date isn't recorded. */
  const mtimeOf = async (area: MoveArea, key: string): Promise<Date | null> => {
    const path = pathInside(dirs[area], key);
    if (!path) return null;
    try {
      return (await stat(path)).mtime;
    } catch {
      return null;
    }
  };

  async function candidates(): Promise<Candidate[]> {
    const projects = new Map<string, ProjectCompanies>();
    for (const p of await prisma.project.findMany({ select: { id: true, ...PROJECT_COMPANY_SELECT } })) projects.set(p.id, p);
    const ofProject = (id: string | null | undefined) => (id ? projects.get(id) : undefined);
    const inProject = (projectId: string | null | undefined) => {
      const p = ofProject(projectId);
      return { want: projectCompanyOf(p ?? null), allowed: companiesOf(p) };
    };
    const out: Candidate[] = [];

    const tasks = await prisma.attachment.findMany({ select: { id: true, storageKey: true, mimeType: true, uploadedById: true, createdAt: true, task: { select: { projectId: true } } } });
    for (const a of tasks) {
      out.push({ area: 'uploads', key: a.storageKey, ref: { table: 'attachment', id: a.id }, type: 'task-files', ...inProject(a.task?.projectId), userId: a.uploadedById, at: a.createdAt, mimeType: a.mimeType });
    }

    const chats = await prisma.chatAttachment.findMany({
      select: { id: true, storageKey: true, mimeType: true, createdAt: true, message: { select: { userId: true, conversation: { select: { projectId: true } } } } },
    });
    for (const a of chats) {
      out.push({ area: 'uploads', key: a.storageKey, ref: { table: 'chatAttachment', id: a.id }, type: 'chat-files', ...inProject(a.message.conversation?.projectId), userId: a.message.userId, at: a.createdAt, mimeType: a.mimeType });
    }

    const notes = await prisma.meetingNoteAttachment.findMany({ select: { id: true, storageKey: true, mimeType: true, uploadedById: true, createdAt: true, note: { select: { meeting: { select: { projectId: true } } } } } });
    for (const a of notes) {
      out.push({ area: 'uploads', key: a.storageKey, ref: { table: 'meetingNoteAttachment', id: a.id }, type: 'meeting-files', ...inProject(a.note?.meeting?.projectId), userId: a.uploadedById, at: a.createdAt, mimeType: a.mimeType });
    }

    const decisions = await prisma.decisionAttachment.findMany({ select: { id: true, storageKey: true, mimeType: true, uploadedById: true, createdAt: true, decision: { select: { projectId: true, meeting: { select: { projectId: true } } } } } });
    for (const a of decisions) {
      const projectId = a.decision?.projectId ?? a.decision?.meeting?.projectId;
      out.push({ area: 'uploads', key: a.storageKey, ref: { table: 'decisionAttachment', id: a.id }, type: 'decision-files', ...inProject(projectId), userId: a.uploadedById, at: a.createdAt, mimeType: a.mimeType });
    }

    const training = await prisma.trainingFile.findMany({ select: { id: true, storageKey: true, mimeType: true, uploadedById: true, createdAt: true } });
    for (const f of training) {
      out.push({ area: 'training', key: f.storageKey, ref: { table: 'trainingFile', id: f.id }, type: 'learning-hub', want: null, allowed: [], userId: f.uploadedById, at: f.createdAt, mimeType: f.mimeType });
    }

    // Pictures kept by their /uploads address (no upload date recorded: the file's own date).
    const pictureOf = async (url: string | null) => {
      const key = storedKeyOf(url);
      return key ? { key, at: await mtimeOf('uploads', key) } : null;
    };
    for (const u of await prisma.user.findMany({ where: { avatarUrl: { startsWith: '/uploads/' } }, select: { id: true, avatarUrl: true } })) {
      const pic = await pictureOf(u.avatarUrl);
      if (pic) out.push({ area: 'uploads', key: pic.key, ref: { table: 'userAvatar', id: u.id }, type: 'profile-photos', want: null, allowed: [], userId: u.id, at: pic.at, mimeType: null });
    }
    for (const p of await prisma.project.findMany({ where: { imageUrl: { startsWith: '/uploads/' } }, select: { id: true, imageUrl: true } })) {
      const pic = await pictureOf(p.imageUrl);
      if (pic) out.push({ area: 'uploads', key: pic.key, ref: { table: 'projectImage', id: p.id }, type: 'project-pictures', ...inProject(p.id), userId: null, at: pic.at, mimeType: null });
    }
    for (const c of await prisma.company.findMany({ where: { logoUrl: { startsWith: '/uploads/' } }, select: { id: true, logoUrl: true } })) {
      const pic = await pictureOf(c.logoUrl);
      if (pic) out.push({ area: 'uploads', key: pic.key, ref: { table: 'companyLogo', id: c.id }, type: 'company-logos', want: c.id, allowed: [c.id], userId: null, at: pic.at, mimeType: null });
    }
    return out;
  }

  /** Point one row at the new key, only while it still has the old one; rows changed (0 or 1). */
  async function point(tx: Pick<PrismaClient, 'attachment' | 'chatAttachment' | 'meetingNoteAttachment' | 'decisionAttachment' | 'trainingFile' | 'user' | 'project' | 'company'>, ref: MoveRowRef, oldKey: string, newKey: string): Promise<number> {
    const oldUrl = `/uploads/${oldKey}`;
    const newUrl = uploadUrlOf(newKey);
    switch (ref.table) {
      case 'attachment':
        return (await tx.attachment.updateMany({ where: { id: ref.id, storageKey: oldKey }, data: { storageKey: newKey, url: newUrl } })).count;
      case 'chatAttachment':
        return (await tx.chatAttachment.updateMany({ where: { id: ref.id, storageKey: oldKey }, data: { storageKey: newKey } })).count;
      case 'meetingNoteAttachment':
        return (await tx.meetingNoteAttachment.updateMany({ where: { id: ref.id, storageKey: oldKey }, data: { storageKey: newKey } })).count;
      case 'decisionAttachment':
        return (await tx.decisionAttachment.updateMany({ where: { id: ref.id, storageKey: oldKey }, data: { storageKey: newKey } })).count;
      case 'trainingFile':
        return (await tx.trainingFile.updateMany({ where: { id: ref.id, storageKey: oldKey }, data: { storageKey: newKey } })).count;
      case 'userAvatar':
        return (await tx.user.updateMany({ where: { id: ref.id, avatarUrl: oldUrl }, data: { avatarUrl: newUrl } })).count;
      case 'projectImage':
        return (await tx.project.updateMany({ where: { id: ref.id, imageUrl: oldUrl }, data: { imageUrl: newUrl } })).count;
      case 'companyLogo':
        return (await tx.company.updateMany({ where: { id: ref.id, logoUrl: oldUrl }, data: { logoUrl: newUrl } })).count;
      default:
        return 0;
    }
  }

  return {
    async plan(): Promise<PlannedMove[]> {
      const groups = new Map<string, PlannedMove>();
      for (const c of await candidates()) {
        const newKey = wantedKey(c);
        if (!newKey || newKey === c.key) continue;
        const id = `${c.area}|${c.key}|${newKey}`;
        const g = groups.get(id) ?? { area: c.area, oldKey: c.key, newKey, rows: [] };
        g.rows.push(c.ref);
        groups.set(id, g);
      }
      return [...groups.values()];
    },

    async commit(m) {
      // Database work only (the file is copied and verified before): safe to try again as a whole.
      return prisma.$transaction(async (tx) => {
        let changed = 0;
        for (const ref of m.rows) changed += await point(tx, ref, m.oldKey, m.newKey);
        if (changed > 0) {
          // One alias per old name (INSERT IGNORE): a name kept by rows of two companies points at the first.
          await tx.fileKeyAlias.createMany({ data: [{ area: m.area, oldKey: m.oldKey, newKey: m.newKey, movedAt: now() }], skipDuplicates: true });
        }
        return changed;
      });
    },

    async aliasesToSweep(before, limit) {
      const rows = await prisma.fileKeyAlias.findMany({ where: { originalRemovedAt: null, movedAt: { lte: before } }, orderBy: { movedAt: 'asc' }, take: limit });
      return rows.map((r) => ({ ...r, area: r.area as MoveArea })) as AliasRow[];
    },

    async stillUsed(area, key) {
      if (area === 'training') return (await prisma.trainingFile.count({ where: { storageKey: key } })) > 0;
      const url = `/uploads/${key}`;
      const counts = await Promise.all([
        prisma.attachment.count({ where: { storageKey: key } }),
        prisma.chatAttachment.count({ where: { storageKey: key } }),
        prisma.meetingNoteAttachment.count({ where: { storageKey: key } }),
        prisma.decisionAttachment.count({ where: { storageKey: key } }),
        prisma.user.count({ where: { avatarUrl: url } }),
        prisma.project.count({ where: { imageUrl: url } }),
        prisma.company.count({ where: { logoUrl: url } }),
      ]);
      return counts.some((n) => n > 0);
    },

    async markSwept(aliasId, at) {
      await prisma.fileKeyAlias.updateMany({ where: { id: aliasId, originalRemovedAt: null }, data: { originalRemovedAt: at } });
    },
  };
}
