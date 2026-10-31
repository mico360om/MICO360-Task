import type { PrismaClient } from '@prisma/client';
import type { Brand } from '../email/brand';
import type { TemplateOptions } from '../email/email-templates';
import { SETTING_SCHEMAS, type SettingsService, type WorkingHours } from '../settings/settings-service';
import { readProjectPicture } from '../../lib/pdf-image';
import { imageDimensions } from '../../lib/image-dimensions';
import type { Viewer } from './company-access';

/**
 * Companies (MC1 Task 14): which company's name, logo, sender name, week start and working hours a
 * PDF, an email or the client page carries.
 *
 *   - A project's documents: its MAIN company (the first of its companies when none is marked).
 *   - A meeting: its project's main company, else the meeting's own company, else its organizer's.
 *   - A person's own emails: their primary company while it is active, else their oldest active one.
 *   - A cross-project document (Reports, Management, MICO AI): the picked company, else the reader's.
 *   - Anything else, or no company: the site's brand, exactly as before companies.
 *
 * The company's NAME replaces the site's COMPANY_NAME only while the site has two or more active
 * companies (with one, every footer stays as it was on upgrade); its logo and sender name apply
 * whenever they are set. Every company is in the site's time zone (owner, 31 Oct: all in Oman).
 * A company's week start and working hours inherit the site's settings until it sets its own.
 *
 * Company rows, the active-company count and logos are cached for `ttlMs` (30 s): branding, never
 * access, so a stale value can only show yesterday's logo for half a minute.
 */
export interface CompanyBrand {
  /** The company whose brand this is; null = the site's own brand. */
  companyId: string | null;
  /** What emails and PDFs print as the company: its name while the site has 2+ active companies, else the site's COMPANY_NAME. */
  name: string;
  /** `name` is the company's own (the site has 2+ active companies). */
  named: boolean;
  /** The company's own name, also with one company (a logo's alt text); null for the site's brand. */
  ownName: string | null;
  /** Its logo as stored ('/uploads/…' or an http(s) address); null = the built-in logo. */
  logoUrl: string | null;
  /** The logo's size in pixels, read from the file; null when there is none or it can't be read. */
  logoSize: { width: number; height: number } | null;
  /** The site's time zone (no company has its own). */
  timeZone: string;
  weekStart: 0 | 1 | 6;
  workingHours: WorkingHours;
  /** The company's own sender name; null = MAIL_FROM's. */
  senderName: string | null;
}

/** What a PDF takes from a brand: the company's name (null: the site's, unchanged) and its logo (null: the built-in one). */
export interface PdfBrand {
  companyName: string | null;
  logo: Buffer | null;
}

/** The client page's company line: its name and logo while the site has 2+ active companies. */
export type ClientPageCompany = { name: string; logoUrl: string | null } | null;

export interface CompanyBranding {
  siteBrand(): Promise<CompanyBrand>;
  forCompany(companyId: string | null): Promise<CompanyBrand>;
  /** The project's main company. */
  forProject(projectId: string): Promise<CompanyBrand>;
  /** The project's main company → the meeting's own company → its organizer's primary company. */
  forMeeting(meetingId: string): Promise<CompanyBrand>;
  /** Their primary company (while active) → their oldest active company → the site. */
  forPerson(userId: string): Promise<CompanyBrand>;
  /** The picked company → the reader's own (forPerson). The pick must already be checked (checkPick). */
  forScope(viewer: Viewer, pick: string | null): Promise<CompanyBrand>;
  /** Template options: the company's name (2+ companies), its logo (absolute address) and sender name — each only when it applies. */
  emailOptions(b: CompanyBrand): { brand: Partial<Brand>; fromName?: string };
  /** The logo as a picture the PDF can print; null → the built-in logo. */
  pdfLogo(b: CompanyBrand): Promise<Buffer | null>;
  pdf(b: CompanyBrand): Promise<PdfBrand>;
  clientPage(b: CompanyBrand): ClientPageCompany;
}

export interface CompanyBrandingDeps {
  prisma: PrismaClient;
  /** The site's own brand: COMPANY_NAME, COMPANY_TIMEZONE and MAIL_FROM's display name. */
  site: { companyName: string; timeZone: string; senderName: string | null };
  settings: Pick<SettingsService, 'companyWeekStart' | 'workingHours'>;
  /** A stored picture's bytes ('/uploads/…'), or null. */
  readImage(url: string): Promise<Buffer | null>;
  /** Converts a picture the PDF can't take as stored (WebP, see-through PNGs) — the picture library. */
  printable?(raw: Buffer): Promise<Buffer | null>;
  /** Where '/uploads/…' is served (the API's public address), for logos in emails. */
  apiBaseUrl: string;
  ttlMs?: number;
}

/** The PDF brands the routes ask for, by what a document is about (each falls back to the site's brand). */
export interface PdfBrands {
  project(projectId: string): Promise<PdfBrand>;
  task(taskId: string): Promise<PdfBrand>;
  meeting(meetingId: string): Promise<PdfBrand>;
  inspection(inspectionId: string): Promise<PdfBrand>;
  scope(viewer: Viewer, pick: string | null): Promise<PdfBrand>;
}

/**
 * The email options the senders ask for: undefined when nothing applies (one company, no logo or
 * sender name of its own), so every email is then sent exactly as before.
 */
export interface EmailBrands {
  person(userId: string): Promise<TemplateOptions | undefined>;
  project(projectId: string): Promise<TemplateOptions | undefined>;
  task(taskId: string): Promise<TemplateOptions | undefined>;
  meeting(meetingId: string): Promise<TemplateOptions | undefined>;
}

/** PDF and email brands over the resolver (a task's and an inspection's project read here). */
export function createDocumentBrands(branding: CompanyBranding, prisma: PrismaClient): { pdf: PdfBrands; email: EmailBrands } {
  const site = () => branding.siteBrand();
  const projectOfTask = async (taskId: string) => (await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } }))?.projectId ?? null;
  const projectOfInspection = async (id: string) => (await prisma.inspection.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null;
  const byProject = async (projectId: string | null) => (projectId ? branding.forProject(projectId) : site());
  const options = (b: CompanyBrand): TemplateOptions | undefined => {
    const o = branding.emailOptions(b);
    return Object.keys(o.brand).length || o.fromName ? o : undefined;
  };
  return {
    pdf: {
      project: async (id) => branding.pdf(await branding.forProject(id)),
      task: async (id) => branding.pdf(await byProject(await projectOfTask(id))),
      meeting: async (id) => branding.pdf(await branding.forMeeting(id)),
      inspection: async (id) => branding.pdf(await byProject(await projectOfInspection(id))),
      scope: async (viewer, pick) => branding.pdf(await branding.forScope(viewer, pick)),
    },
    email: {
      person: async (id) => options(await branding.forPerson(id)),
      project: async (id) => options(await branding.forProject(id)),
      task: async (id) => options(await byProject(await projectOfTask(id))),
      meeting: async (id) => options(await branding.forMeeting(id)),
    },
  };
}

/** The email header's logo box: at most 160 × 30 pixels, keeping the logo's shape. */
export function fitLogo(size: { width: number; height: number }, maxW = 160, maxH = 30): { width: number; height: number } {
  const k = Math.min(maxW / size.width, maxH / size.height);
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}

interface CompanyRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  logoUrl: string | null;
  senderName: string | null;
  weekStart: number | null;
  workingHours: unknown;
}

const WEEK_STARTS = new Set([0, 1, 6]);

export function createCompanyBranding(deps: CompanyBrandingDeps): CompanyBranding {
  const { prisma, site } = deps;
  const ttl = deps.ttlMs ?? 30_000;
  const base = deps.apiBaseUrl.replace(/\/+$/, '');

  /** A small time-limited cache (ttl 0: none). */
  function cached<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
    const kept = new Map<K, { at: number; value: Promise<V> }>();
    return (key) => {
      const now = Date.now();
      const hit = kept.get(key);
      if (ttl > 0 && hit && now - hit.at < ttl) return hit.value;
      const value = load(key);
      if (ttl > 0) {
        kept.set(key, { at: now, value });
        value.catch(() => kept.delete(key));
        if (kept.size > 500) for (const [k, v] of kept) if (now - v.at >= ttl) kept.delete(k);
      }
      return value;
    };
  }

  const companyRow = cached(
    (id: string): Promise<CompanyRow | null> =>
      prisma.company.findUnique({
        where: { id },
        select: { id: true, name: true, status: true, logoUrl: true, senderName: true, weekStart: true, workingHours: true },
      }) as Promise<CompanyRow | null>,
  );
  const activeCount = cached((_: 'active') => prisma.company.count({ where: { status: 'ACTIVE' } }));
  /** A stored logo: the bytes the PDF prints and its size in pixels (nulls when it can't be read). */
  const logoFile = cached(async (url: string): Promise<{ printable: Buffer | null; size: { width: number; height: number } | null }> => {
    const raw = await deps.readImage(url).catch(() => null);
    if (!raw) return { printable: null, size: null };
    const printable = await readProjectPicture(url, async () => raw, deps.printable);
    return { printable, size: imageDimensions(raw) };
  });

  async function brandOf(row: CompanyRow | null): Promise<CompanyBrand> {
    const [siteWeek, siteHours, active] = await Promise.all([deps.settings.companyWeekStart(), deps.settings.workingHours(), row ? activeCount('active') : Promise.resolve(0)]);
    const named = row !== null && active >= 2;
    const hours = row?.workingHours != null ? SETTING_SCHEMAS['meetings.workingHours'].safeParse(row.workingHours) : null;
    const logoSize = row?.logoUrl ? (await logoFile(row.logoUrl)).size : null;
    return {
      companyId: row?.id ?? null,
      name: named ? row!.name : site.companyName,
      named,
      ownName: row?.name ?? null,
      logoUrl: row?.logoUrl ?? null,
      logoSize,
      timeZone: site.timeZone,
      weekStart: row?.weekStart != null && WEEK_STARTS.has(row.weekStart) ? (row.weekStart as 0 | 1 | 6) : siteWeek,
      workingHours: hours?.success ? hours.data : siteHours,
      senderName: row?.senderName?.trim() ? row.senderName.trim() : null,
    };
  }

  const forCompany = async (companyId: string | null): Promise<CompanyBrand> => brandOf(companyId ? await companyRow(companyId) : null);

  async function mainCompanyOf(projectId: string): Promise<string | null> {
    const p = await prisma.project.findUnique({
      where: { id: projectId },
      select: { mainCompanyId: true, companies: { select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }], take: 1 } },
    });
    return p?.mainCompanyId ?? p?.companies[0]?.companyId ?? null;
  }

  async function personCompanyOf(userId: string): Promise<string | null> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        primaryCompanyId: true,
        companies: { where: { company: { status: 'ACTIVE' } }, select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }] },
      },
    });
    if (!u) return null;
    const active = u.companies.map((c) => c.companyId);
    return u.primaryCompanyId && active.includes(u.primaryCompanyId) ? u.primaryCompanyId : (active[0] ?? null);
  }

  const forPerson = async (userId: string) => forCompany(await personCompanyOf(userId));

  return {
    siteBrand: () => brandOf(null),
    forCompany,
    forProject: async (projectId) => forCompany(await mainCompanyOf(projectId)),
    async forMeeting(meetingId) {
      const m = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { projectId: true, companyId: true, organizerId: true } });
      if (!m) return brandOf(null);
      const id = (m.projectId ? await mainCompanyOf(m.projectId) : null) ?? m.companyId ?? (await personCompanyOf(m.organizerId));
      return forCompany(id);
    },
    forPerson,
    forScope: async (viewer, pick) => (pick ? forCompany(pick) : forPerson(viewer.id)),

    emailOptions(b) {
      const brand: Partial<Brand> = {};
      if (b.named) brand.companyName = b.name;
      const url = b.logoUrl ? (/^https?:\/\//i.test(b.logoUrl) ? b.logoUrl : b.logoUrl.startsWith('/') ? `${base}${b.logoUrl}` : null) : null;
      // A logo that can't be read (or measured) stays the built-in one: an email shows nothing broken.
      if (url && b.logoSize) {
        brand.logoUrl = url;
        brand.logoBox = { ...fitLogo(b.logoSize), alt: b.ownName ?? b.name };
      }
      return b.senderName ? { brand, fromName: b.senderName } : { brand };
    },

    async pdfLogo(b) {
      return b.logoUrl ? (await logoFile(b.logoUrl)).printable : null;
    },
    async pdf(b) {
      return { companyName: b.named ? b.name : null, logo: b.logoUrl ? (await logoFile(b.logoUrl)).printable : null };
    },
    clientPage: (b) => (b.named ? { name: b.name, logoUrl: b.logoUrl } : null),
  };
}
