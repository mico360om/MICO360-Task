import { randomUUID } from 'node:crypto';

/** A client a project is shared with. `email` is kept trimmed and in lower case. */
export interface ClientShareRecord {
  id: string;
  projectId: string;
  name: string;
  email: string;
  /** SHA-256 of the current link's token. */
  linkHash: string;
  createdById: string | null;
  linkSentAt: Date | null;
  lastViewedAt: Date | null;
  createdAt: Date;
}

export interface ClientCodeRecord {
  id: string;
  shareId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface ClientSessionRecord {
  shareId: string;
  expiresAt: Date;
}

/** The project already has a share with that address. */
export class ClientShareExistsError extends Error {
  constructor() {
    super('This project is already shared with that address.');
    this.name = 'ClientShareExistsError';
  }
}

export interface ClientShareStore {
  listForProject(projectId: string): Promise<ClientShareRecord[]>;
  findById(id: string): Promise<ClientShareRecord | null>;
  findByLinkHash(linkHash: string): Promise<ClientShareRecord | null>;
  findByEmail(projectId: string, email: string): Promise<ClientShareRecord | null>;
  /** Throws ClientShareExistsError when the project is already shared with the address. */
  create(data: { projectId: string; name: string; email: string; linkHash: string; createdById: string | null }): Promise<ClientShareRecord>;
  /** Removes the share with its codes and sessions. False when it was already gone. */
  delete(id: string): Promise<boolean>;
  /**
   * The link becomes `toHash`, only while it is still `fromHash` (false otherwise); every code not used
   * yet ends with it, so an old email's link and code both stop working.
   */
  replaceLink(id: string, fromHash: string, toHash: string): Promise<boolean>;
  markSent(id: string, at: Date): Promise<void>;
  markViewed(id: string, at: Date): Promise<void>;

  /** Stores a new code and ends the share's earlier unused ones (only the newest can be tried). */
  createCode(data: { shareId: string; codeHash: string; expiresAt: Date }): Promise<void>;
  latestOpenCode(shareId: string): Promise<ClientCodeRecord | null>;
  countCodesSince(shareId: string, since: Date): Promise<number>;
  /** Failed tries at the share's codes issued since `since`, across all of them. */
  countFailuresSince(shareId: string, since: Date): Promise<number>;
  /** Counts a try atomically: true while the code is unused and has tries left. */
  claimAttempt(codeId: string, max: number): Promise<boolean>;
  /** Marks the code used, once (and un-counts the try that succeeded). */
  consumeCode(codeId: string): Promise<boolean>;

  createSession(data: { shareId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  /** A session by its token's hash (expired ones too: the caller checks the time). */
  findSession(tokenHash: string): Promise<ClientSessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Drops the share's expired sessions and all but its `keep` newest. */
  pruneSessions(shareId: string, now: Date, keep: number): Promise<void>;
}

/** In-memory store with the same rules as the Prisma one (unit tests; see client-share-store.contract). */
export function createMemoryClientShareStore(now: () => Date = () => new Date()): ClientShareStore {
  const shares = new Map<string, ClientShareRecord>();
  const codes = new Map<string, ClientCodeRecord & { seq: number }>();
  const sessions = new Map<string, ClientSessionRecord & { tokenHash: string; createdAt: number; seq: number }>();
  let seq = 0;
  const copy = <T>(v: T | undefined | null): T | null => (v ? { ...v } : null);

  return {
    async listForProject(projectId) {
      return [...shares.values()].filter((s) => s.projectId === projectId).map((s) => ({ ...s }));
    },
    async findById(id) {
      return copy(shares.get(id));
    },
    async findByLinkHash(linkHash) {
      return copy([...shares.values()].find((s) => s.linkHash === linkHash));
    },
    async findByEmail(projectId, email) {
      return copy([...shares.values()].find((s) => s.projectId === projectId && s.email === email));
    },
    async create(data) {
      if ([...shares.values()].some((s) => s.projectId === data.projectId && s.email === data.email)) throw new ClientShareExistsError();
      const share: ClientShareRecord = { id: `cs-${randomUUID()}`, ...data, linkSentAt: null, lastViewedAt: null, createdAt: now() };
      shares.set(share.id, share);
      return { ...share };
    },
    async delete(id) {
      if (!shares.delete(id)) return false;
      for (const [k, c] of codes) if (c.shareId === id) codes.delete(k);
      for (const [k, s] of sessions) if (s.shareId === id) sessions.delete(k);
      return true;
    },
    async replaceLink(id, fromHash, toHash) {
      const s = shares.get(id);
      if (!s || s.linkHash !== fromHash) return false;
      s.linkHash = toHash;
      for (const c of codes.values()) if (c.shareId === id && !c.consumedAt) c.consumedAt = now();
      return true;
    },
    async markSent(id, at) {
      const s = shares.get(id);
      if (s) s.linkSentAt = at;
    },
    async markViewed(id, at) {
      const s = shares.get(id);
      if (s) s.lastViewedAt = at;
    },
    async createCode(data) {
      for (const c of codes.values()) if (c.shareId === data.shareId && !c.consumedAt) c.consumedAt = now();
      const id = `cc-${randomUUID()}`;
      codes.set(id, { id, ...data, attempts: 0, consumedAt: null, createdAt: now(), seq: seq++ });
    },
    async latestOpenCode(shareId) {
      const open = [...codes.values()].filter((c) => c.shareId === shareId && !c.consumedAt).sort((a, b) => b.seq - a.seq);
      if (!open[0]) return null;
      const { seq: _seq, ...code } = open[0];
      return code;
    },
    async countCodesSince(shareId, since) {
      return [...codes.values()].filter((c) => c.shareId === shareId && c.createdAt >= since).length;
    },
    async countFailuresSince(shareId, since) {
      return [...codes.values()].filter((c) => c.shareId === shareId && c.createdAt >= since).reduce((n, c) => n + c.attempts, 0);
    },
    async claimAttempt(codeId, max) {
      const c = codes.get(codeId);
      if (!c || c.consumedAt || c.attempts >= max) return false;
      c.attempts += 1;
      return true;
    },
    async consumeCode(codeId) {
      const c = codes.get(codeId);
      if (!c || c.consumedAt) return false;
      c.consumedAt = now();
      c.attempts -= 1;
      return true;
    },
    async createSession(data) {
      sessions.set(data.tokenHash, { ...data, createdAt: now().getTime(), seq: seq++ });
    },
    async findSession(tokenHash) {
      const s = sessions.get(tokenHash);
      return s ? { shareId: s.shareId, expiresAt: s.expiresAt } : null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async pruneSessions(shareId, now, keep) {
      for (const [k, s] of sessions) if (s.shareId === shareId && s.expiresAt <= now) sessions.delete(k);
      const mine = [...sessions.values()].filter((s) => s.shareId === shareId).sort((a, b) => b.seq - a.seq);
      for (const s of mine.slice(keep)) sessions.delete(s.tokenHash);
    },
  };
}
