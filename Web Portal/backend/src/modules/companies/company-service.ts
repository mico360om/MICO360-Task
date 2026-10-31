import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { sniffMime } from '../../lib/magic-mime';
import { SETTING_SCHEMAS, type WorkingHours } from '../settings/settings-service';
import type { AuditService } from '../audit/audit-service';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { COMPANY_CODE, COMPANY_WORDS, normalizeCompanyCode, type CompanyStatus } from './company-rules';
import { isAdminRoles, type Viewer } from './company-access';
import type { CompanyPatch, CompanyPerson, CompanyProject, CompanyRecord, CompanyRepository, WeekStart } from './company-repository';

/**
 * Companies (System → Companies): create, edit, logo, archive, and each company's people and
 * projects — administrators only — plus each person's own companies (GET /me/companies).
 * A company inherits the site's week start, working hours, sender name and logo until an
 * administrator sets its own; every company uses the site's time zone.
 */

/** A company's details as typed on the Companies page. */
export interface CompanyInput {
  name: string;
  code: string;
  /** Companies use the site's time zone: only null (or nothing) is taken. */
  timeZone?: string | null;
  weekStart?: WeekStart | null;
  workingHours?: WorkingHours | null;
  senderName?: string | null;
}

/** The site's values a company inherits until it has its own. */
export interface CompanySiteDefaults {
  timeZone: string;
  weekStart: WeekStart;
  workingHours: WorkingHours;
  senderName: string;
}

export interface ApiCompany {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  /** Always null: every company uses the site's time zone (effective.timeZone). */
  timeZone: string | null;
  weekStart: WeekStart | null;
  workingHours: WorkingHours | null;
  senderName: string | null;
  status: CompanyStatus;
  archivedAt: string | null;
  createdAt: string;
  counts: { people: number; projects: number };
  effective: { timeZone: string; weekStart: WeekStart; workingHours: WorkingHours; senderName: string };
}

/** One of the person's companies, with the site's values filled in. */
export interface MyCompany {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  timeZone: string;
  weekStart: WeekStart;
  workingHours: WorkingHours;
}

export interface MyCompanies {
  /** Their active companies (administrators: every active company), A–Z. */
  companies: MyCompany[];
  primaryCompanyId: string | null;
  /** A non-admin with no active company: the clients show "Your company is archived — ask an administrator." */
  allArchived: boolean;
  /** Active companies on the site. */
  siteCompanyCount: number;
}

/** Who lost or gained access (people) and which projects' audiences changed — the realtime server re-checks them (MC1 Task 12). */
export type OnCompanyAccessChanged = (userIds: string[], projectIds?: string[]) => void;

/** People put in or taken out of a company, and the people it couldn't change (with why). */
export interface Refusal {
  userId: string;
  name: string;
  reason: string;
}
export interface PeopleChange {
  changed: number;
  refused: Refusal[];
}

/** Adds people to and takes them out of companies (MC1 Task 6 checks the rules there). */
export interface CompanyPeopleWriter {
  add(userIds: string[], companyIds: string[], actor: Viewer): Promise<PeopleChange>;
  remove(userIds: string[], companyIds: string[], actor: Viewer): Promise<PeopleChange>;
}

export const COMPANY_ADMIN_WORDS = {
  notFound: 'Company not found.',
  name: 'Give the company a name of up to 120 characters.',
  code: 'Use 2–10 capital letters or digits for the short code.',
  duplicateName: 'A company with this name already exists.',
  duplicateCode: 'A company with this code already exists.',
  timeZone: 'Companies use the site’s time zone.',
  weekStart: 'The week can start on Sunday, Monday or Saturday.',
  workingHours: 'Choose at least one working day, and times like 08:00.',
  senderName: 'The sender name can’t contain < > or quotes.',
  senderLength: 'The sender name can have up to 120 characters.',
  logo: 'The logo must be a PNG, JPEG or WebP picture up to 2 MB.',
  uploadsOff: 'Uploads are not enabled.',
} as const;

const W = COMPANY_ADMIN_WORDS;
const WEEK_STARTS: readonly unknown[] = [0, 1, 6];
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const SENDER_FORBIDDEN = /[<>"\r\n]/;

/** The display name in a "Name <address>" sender (MAIL_FROM), else the address itself. */
export function mailFromName(from: string): string {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const name = match?.[1]?.replace(/^"(.*)"$/, '$1').trim();
  return name || (match?.[2] ?? from).trim();
}

const fail = (message: string): never => {
  throw new ValidationError(message);
};

/** The fields present in `raw`, checked and tidied (all of name and code when `whole`). */
function cleanInput(raw: Partial<Record<keyof CompanyInput, unknown>>, whole: boolean): CompanyPatch {
  const out: CompanyPatch = {};
  if (whole || raw.name !== undefined) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name || name.length > 120) fail(W.name);
    out.name = name;
  }
  if (whole || raw.code !== undefined) {
    const code = typeof raw.code === 'string' ? normalizeCompanyCode(raw.code) : '';
    if (!COMPANY_CODE.test(code)) fail(W.code);
    out.code = code;
  }
  if (raw.timeZone !== undefined && raw.timeZone !== null) fail(W.timeZone);
  if (raw.weekStart !== undefined) {
    if (raw.weekStart !== null && !WEEK_STARTS.includes(raw.weekStart)) fail(W.weekStart);
    out.weekStart = raw.weekStart as WeekStart | null;
  }
  if (raw.workingHours !== undefined) {
    if (raw.workingHours === null) out.workingHours = null;
    else {
      const parsed = SETTING_SCHEMAS['meetings.workingHours'].safeParse(raw.workingHours);
      if (!parsed.success) fail(parsed.error.issues.find((i) => i.code === 'custom' || i.code === 'invalid_string')?.message ?? W.workingHours);
      else out.workingHours = parsed.data;
    }
  }
  if (raw.senderName !== undefined) {
    if (raw.senderName !== null && typeof raw.senderName !== 'string') fail(W.senderName);
    const sender = typeof raw.senderName === 'string' ? raw.senderName.trim() : '';
    if (sender.length > 120) fail(W.senderLength);
    if (SENDER_FORBIDDEN.test(sender)) fail(W.senderName);
    out.senderName = sender || null;
  }
  return out;
}

/** '/uploads/<key>' → '<key>' (only for files this server stored). */
const storedKey = (url: string | null | undefined) => (url && url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null);

export interface CompanyServiceDeps {
  companies: CompanyRepository;
  /** The site's values (System Settings, COMPANY_TIMEZONE, MAIL_FROM), read when needed. */
  site: () => Promise<CompanySiteDefaults>;
  audit?: Pick<AuditService, 'record'>;
  /** Where logos are kept (the uploads store); without it, logos can't be uploaded. */
  storage?: AttachmentStorage;
  /** Makes a logo smaller before it is stored (at most 512 pixels on its long side). */
  shrink?: (content: Buffer, mimeType: string) => Promise<Buffer>;
  /** Told whose access changed (archive, unarchive, people added or taken out). */
  onAccessChanged?: OnCompanyAccessChanged;
  /** Adds and removes people with the membership rules (MC1 Task 6); else plainly. */
  people?: CompanyPeopleWriter;
}

export function createCompanyService(deps: CompanyServiceDeps) {
  const repo = deps.companies;
  const changed = (userIds: string[], projectIds?: string[]) => {
    if (userIds.length === 0 && !projectIds?.length) return;
    try {
      if (projectIds === undefined) deps.onAccessChanged?.(userIds);
      else deps.onAccessChanged?.(userIds, projectIds);
    } catch {
      // Live updates are best effort: every request checks access again anyway.
    }
  };
  const log = (actor: Viewer, ip: string | null | undefined, action: string, entityId: string, oldValue?: unknown, newValue?: unknown) =>
    deps.audit?.record({ userId: actor.id, ip: ip ?? null, module: 'companies', action, entityId, ...(oldValue !== undefined ? { oldValue } : {}), ...(newValue !== undefined ? { newValue } : {}) });

  async function record(id: string): Promise<CompanyRecord> {
    const c = await repo.findById(id);
    if (!c) throw new NotFoundError(W.notFound);
    return c;
  }

  function toApi(c: CompanyRecord, site: CompanySiteDefaults, counts: { people: number; projects: number } | undefined): ApiCompany {
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      logoUrl: c.logoUrl,
      timeZone: null,
      weekStart: c.weekStart,
      workingHours: c.workingHours,
      senderName: c.senderName,
      status: c.status,
      archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      counts: counts ?? { people: 0, projects: 0 },
      effective: {
        timeZone: site.timeZone,
        weekStart: c.weekStart ?? site.weekStart,
        workingHours: c.workingHours ?? site.workingHours,
        senderName: c.senderName ?? site.senderName,
      },
    };
  }

  async function many(rows: CompanyRecord[]): Promise<ApiCompany[]> {
    const [site, counts] = await Promise.all([deps.site(), repo.counts(rows.map((c) => c.id))]);
    return rows.map((c) => toApi(c, site, counts.get(c.id)));
  }
  const one = async (c: CompanyRecord) => (await many([c]))[0]!;

  /** Names and codes are unique (names ignoring case). */
  async function ensureUnique(patch: CompanyPatch, selfId?: string): Promise<void> {
    if (patch.name !== undefined) {
      const same = await repo.findByName(patch.name);
      if (same && same.id !== selfId) throw new ConflictError(W.duplicateName, 'DUPLICATE_COMPANY_NAME');
    }
    if (patch.code !== undefined) {
      const same = await repo.findByCode(patch.code);
      if (same && same.id !== selfId) throw new ConflictError(W.duplicateCode, 'DUPLICATE_COMPANY_CODE');
    }
  }

  async function list(): Promise<ApiCompany[]> {
    return many(await repo.list());
  }

  async function get(id: string): Promise<ApiCompany> {
    return one(await record(id));
  }

  async function create(input: CompanyInput, actor: Viewer, ip?: string | null): Promise<ApiCompany> {
    const clean = cleanInput(input, true);
    await ensureUnique(clean);
    const created = await repo.create({ name: clean.name!, code: clean.code!, weekStart: clean.weekStart, workingHours: clean.workingHours, senderName: clean.senderName, createdById: actor.id });
    await log(actor, ip, 'company.create', created.id, undefined, { name: created.name, code: created.code, weekStart: created.weekStart, workingHours: created.workingHours, senderName: created.senderName });
    return one(created);
  }

  async function update(id: string, patch: Partial<CompanyInput>, actor: Viewer, ip?: string | null): Promise<ApiCompany> {
    const before = await record(id);
    const clean = cleanInput(patch, false);
    await ensureUnique(clean, id);
    const keys = (Object.keys(clean) as (keyof CompanyPatch)[]).filter((k) => JSON.stringify(clean[k]) !== JSON.stringify(before[k]));
    if (keys.length === 0) return one(before);
    const updated = await repo.update(id, clean);
    await log(actor, ip, 'company.update', id, Object.fromEntries(keys.map((k) => [k, before[k]])), Object.fromEntries(keys.map((k) => [k, updated[k]])));
    return one(updated);
  }

  async function setLogo(id: string, file: { buffer: Buffer; mimetype: string }, actor: Viewer, ip?: string | null): Promise<ApiCompany> {
    if (!deps.storage) throw new ValidationError(W.uploadsOff);
    const before = await record(id);
    const { buffer, mimetype } = file;
    if (!LOGO_TYPES.includes(mimetype) || buffer.length === 0 || buffer.length > LOGO_MAX_BYTES || sniffMime(buffer) !== mimetype) fail(W.logo);
    const content = deps.shrink ? await deps.shrink(buffer, mimetype) : buffer;
    const saved = await deps.storage.save({ filename: `company-logo-${id}`, mimeType: mimetype, content });
    const updated = await repo.update(id, { logoUrl: saved.url });
    // The logo it replaces is no longer used anywhere.
    const old = storedKey(before.logoUrl);
    if (old) await deps.storage.remove(old).catch(() => {});
    await log(actor, ip, 'company.logo', id, { logoUrl: before.logoUrl }, { logoUrl: updated.logoUrl });
    return one(updated);
  }

  async function clearLogo(id: string, actor: Viewer, ip?: string | null): Promise<ApiCompany> {
    const before = await record(id);
    if (before.logoUrl === null) return one(before);
    const updated = await repo.update(id, { logoUrl: null });
    const old = storedKey(before.logoUrl);
    if (old && deps.storage) await deps.storage.remove(old).catch(() => {});
    await log(actor, ip, 'company.logo.remove', id, { logoUrl: before.logoUrl }, { logoUrl: null });
    return one(updated);
  }

  /** Who and which projects an archive or unarchive touches. */
  async function audienceOf(id: string): Promise<[string[], string[]]> {
    return Promise.all([repo.memberIds(id), repo.projectIds(id)]);
  }

  async function archive(id: string, actor: Viewer, ip?: string | null): Promise<ApiCompany> {
    const before = await record(id);
    if (before.status === 'ARCHIVED') return one(before);
    if ((await repo.countActive()) <= 1) throw new ConflictError(COMPANY_WORDS.lastActive, 'LAST_ACTIVE_COMPANY');
    const updated = await repo.update(id, { status: 'ARCHIVED', archivedAt: new Date() });
    await log(actor, ip, 'company.archive', id, { status: 'ACTIVE' }, { status: 'ARCHIVED' });
    changed(...(await audienceOf(id)));
    return one(updated);
  }

  async function unarchive(id: string, actor: Viewer, ip?: string | null): Promise<ApiCompany> {
    const before = await record(id);
    if (before.status === 'ACTIVE') return one(before);
    const updated = await repo.update(id, { status: 'ACTIVE', archivedAt: null });
    await log(actor, ip, 'company.unarchive', id, { status: 'ARCHIVED' }, { status: 'ACTIVE' });
    changed(...(await audienceOf(id)));
    return one(updated);
  }

  async function people(id: string): Promise<CompanyPerson[]> {
    await record(id);
    return repo.people(id);
  }

  async function projects(id: string): Promise<CompanyProject[]> {
    await record(id);
    return repo.projects(id);
  }

  /** Puts people in the company (the Companies page's "Add people"). */
  async function addPeople(id: string, userIds: string[], actor: Viewer, ip?: string | null): Promise<PeopleChange> {
    await record(id);
    const ids = [...new Set(userIds)];
    let result: PeopleChange;
    if (deps.people) result = await deps.people.add(ids, [id], actor);
    else {
      result = { changed: await repo.addMembers(id, ids, actor.id), refused: [] };
      changed(ids);
    }
    if (result.changed > 0) await log(actor, ip, 'company.people.add', id, undefined, { userIds: ids.filter((u) => !result.refused.some((r) => r.userId === u)) });
    return result;
  }

  /** Takes a person out of the company (the Companies page's ✕); refused with the rule's words. */
  async function removePerson(id: string, userId: string, actor: Viewer, ip?: string | null): Promise<PeopleChange> {
    await record(id);
    let result: PeopleChange;
    if (deps.people) result = await deps.people.remove([userId], [id], actor);
    else {
      result = { changed: (await repo.removeMember(id, userId)) ? 1 : 0, refused: [] };
      changed([userId]);
    }
    if (result.changed > 0) await log(actor, ip, 'company.people.remove', id, { userId }, undefined);
    return result;
  }

  async function mine(viewer: Viewer): Promise<MyCompanies> {
    const admin = isAdminRoles(viewer.roles);
    const [rows, primaryCompanyId, siteCompanyCount, site] = await Promise.all([
      admin ? repo.list().then((all) => all.filter((c) => c.status === 'ACTIVE')) : repo.activeOf(viewer.id),
      repo.primaryOf(viewer.id),
      repo.countActive(),
      deps.site(),
    ]);
    return {
      companies: rows.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        logoUrl: c.logoUrl,
        timeZone: site.timeZone,
        weekStart: c.weekStart ?? site.weekStart,
        workingHours: c.workingHours ?? site.workingHours,
      })),
      primaryCompanyId,
      allArchived: !admin && rows.length === 0,
      siteCompanyCount,
    };
  }

  return { list, get, create, update, setLogo, clearLogo, archive, unarchive, people, projects, addPeople, removePerson, mine };
}

export type CompanyService = ReturnType<typeof createCompanyService>;
