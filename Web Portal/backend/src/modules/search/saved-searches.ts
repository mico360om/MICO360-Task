import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/http-errors';
import { SEARCH_KINDS } from './search-types';
import { READER_CHIP_KEYS } from './search-reader';
import { TASK_STATUSES } from './task-search-engine';
import type { SearchViewer } from './task-search-scope';

/**
 * 1.23.6 Saved searches: a person's search — the words as typed, the Search page's filters and the
 * reader's chips taken off — under a name (owner answer 2).
 *  - Personal by default; its owner may share it with the team of one project they run (an
 *    administrator, the project's owner or named manager, or a manager on its team). The team (owner,
 *    named manager and members, inside their companies) sees it under "Shared with you" and may use and
 *    pin it — never change it. Unsharing takes it off everyone else's side menu.
 *  - Up to MAX_PINS pinned to the side menu per person (their own or shared with them).
 *  - It is read again whenever it runs, for whoever runs it: "me" is them, and the results always
 *    follow their own access (a shared search's project filter finds nothing for someone who can't see
 *    that project). Its count is the same search's, cached for a minute (search-routes).
 */

export const MAX_PINS = 5;
export const MAX_SAVED = 50;
export const NAME_MAX = 80;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-11-03.');
/** What a saved search keeps of the Search page (its address, without the words). */
export const savedFiltersSchema = z
  .object({
    type: z.enum(SEARCH_KINDS).optional(),
    projectId: z.string().min(1).max(64).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    person: z.string().min(1).max(64).optional(),
    from: day.optional(),
    to: day.optional(),
    done: z.boolean().optional(),
    archived: z.boolean().optional(),
    off: z.array(z.enum(READER_CHIP_KEYS)).max(READER_CHIP_KEYS.length).optional(),
    plain: z.boolean().optional(),
  })
  .strict();
export type SavedFilters = z.infer<typeof savedFiltersSchema>;

export const savedSearchBody = z.object({
  name: z.string().trim().min(1, 'Give the search a name.').max(NAME_MAX, `A name is at most ${NAME_MAX} characters.`),
  q: z.string().max(200).default(''),
  filters: savedFiltersSchema.default({}),
});

export interface SavedSearchView {
  id: string;
  name: string;
  q: string;
  filters: SavedFilters;
  /** The person who saved it (their name), and whether that is the viewer. */
  owner: { id: string; name: string };
  mine: boolean;
  /** The project team it is shared with. */
  shared: { projectId: string; code: string; name: string } | null;
  pinned: boolean;
  updatedAt: string;
}

export interface SavedSearchList {
  mine: SavedSearchView[];
  /** Shared with a team the person is on (not their own). */
  shared: SavedSearchView[];
  /** The pinned ones, in the side menu's order. */
  pinned: string[];
}

export interface SavedSearchDeps {
  prisma: Pick<PrismaClient, 'savedSearch' | 'savedSearchPin' | 'project' | '$transaction'>;
  /** The projects a person's lists show (with no pick); null = every one (an administrator). */
  accessibleProjectIds: (userId: string, roles: string[]) => Promise<string[] | null>;
  /** Of these projects, those the person runs (may share a search with). */
  manageableProjectIds: (userId: string, roles: string[], projectIds: string[]) => Promise<Set<string>>;
}

const notFound = () => new NotFoundError('That saved search no longer exists.');
const readFilters = (raw: Prisma.JsonValue | null): SavedFilters => {
  const parsed = savedFiltersSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
};
const nameOf = (u: { firstName: string; lastName: string; username: string }) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username;

const SELECT = {
  id: true,
  ownerId: true,
  name: true,
  q: true,
  filters: true,
  projectId: true,
  updatedAt: true,
  owner: { select: { firstName: true, lastName: true, username: true, deletedAt: true } },
  project: { select: { id: true, code: true, name: true, deletedAt: true } },
} as const;
type Row = Prisma.SavedSearchGetPayload<{ select: typeof SELECT }>;

export function createSavedSearches(deps: SavedSearchDeps) {
  const { prisma } = deps;

  /** The projects whose team the person is on (owner, named manager or member), inside their companies. */
  async function teamProjects(viewer: SearchViewer): Promise<string[]> {
    const [team, allowed] = await Promise.all([
      prisma.project.findMany({ where: { deletedAt: null, OR: [{ ownerId: viewer.id }, { managerId: viewer.id }, { members: { some: { userId: viewer.id } } }] }, select: { id: true } }),
      deps.accessibleProjectIds(viewer.id, viewer.roles),
    ]);
    const ok = allowed ? new Set(allowed) : null;
    return team.map((p) => p.id).filter((id) => !ok || ok.has(id));
  }

  /** The person's own searches and those shared with their teams (live owner and project only). */
  async function visibleRows(viewer: SearchViewer): Promise<Row[]> {
    const teams = await teamProjects(viewer);
    const rows = await prisma.savedSearch.findMany({
      where: { OR: [{ ownerId: viewer.id }, ...(teams.length ? [{ projectId: { in: teams }, ownerId: { not: viewer.id } }] : [])] },
      select: SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.filter((r) => r.ownerId === viewer.id || (!r.owner.deletedAt && r.project && !r.project.deletedAt));
  }

  const view = (r: Row, viewer: SearchViewer, pinned: ReadonlySet<string>): SavedSearchView => ({
    id: r.id,
    name: r.name,
    q: r.q,
    filters: readFilters(r.filters),
    owner: { id: r.ownerId, name: nameOf(r.owner) },
    mine: r.ownerId === viewer.id,
    shared: r.project && !r.project.deletedAt ? { projectId: r.project.id, code: r.project.code, name: r.project.name } : null,
    pinned: pinned.has(r.id),
    updatedAt: r.updatedAt.toISOString(),
  });

  async function list(viewer: SearchViewer): Promise<SavedSearchList> {
    const [rows, pins] = await Promise.all([visibleRows(viewer), prisma.savedSearchPin.findMany({ where: { userId: viewer.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { savedSearchId: true } })]);
    const visible = new Set(rows.map((r) => r.id));
    const pinned = pins.map((p) => p.savedSearchId).filter((id) => visible.has(id));
    const set = new Set(pinned);
    return {
      mine: rows.filter((r) => r.ownerId === viewer.id).map((r) => view(r, viewer, set)),
      shared: rows.filter((r) => r.ownerId !== viewer.id).map((r) => view(r, viewer, set)),
      pinned,
    };
  }

  /** One saved search the person may use (theirs, or shared with their team) — or 404. */
  async function usable(viewer: SearchViewer, id: string): Promise<SavedSearchView> {
    const rows = await visibleRows(viewer);
    const row = rows.find((r) => r.id === id);
    if (!row) throw notFound();
    const pin = await prisma.savedSearchPin.findUnique({ where: { userId_savedSearchId: { userId: viewer.id, savedSearchId: id } }, select: { userId: true } });
    return view(row, viewer, new Set(pin ? [id] : []));
  }

  /** One the person owns: someone else's they may see is theirs to use, not change (403); else 404. */
  async function owned(viewer: SearchViewer, id: string): Promise<SavedSearchView> {
    const found = await usable(viewer, id);
    if (!found.mine) throw new ForbiddenError(`Only ${found.owner.name} can change this search. You can use it and pin it.`);
    return found;
  }

  async function nameTaken(ownerId: string, name: string, except?: string): Promise<boolean> {
    const same = await prisma.savedSearch.findMany({ where: { ownerId, ...(except ? { id: { not: except } } : {}) }, select: { name: true } });
    return same.some((s) => s.name.trim().toLocaleLowerCase('en') === name.trim().toLocaleLowerCase('en'));
  }

  async function create(viewer: SearchViewer, input: z.infer<typeof savedSearchBody>): Promise<SavedSearchView> {
    const body = savedSearchBody.parse(input);
    if ((await prisma.savedSearch.count({ where: { ownerId: viewer.id } })) >= MAX_SAVED) throw new ConflictError(`You can keep up to ${MAX_SAVED} saved searches. Delete one first.`, 'SAVED_LIMIT');
    if (await nameTaken(viewer.id, body.name)) throw new ConflictError(`You already have a search called “${body.name}”.`, 'NAME_TAKEN');
    const row = await prisma.savedSearch.create({ data: { ownerId: viewer.id, name: body.name, q: body.q.trim(), filters: body.filters as Prisma.InputJsonValue }, select: { id: true } });
    return usable(viewer, row.id);
  }

  async function update(viewer: SearchViewer, id: string, input: Partial<z.infer<typeof savedSearchBody>>): Promise<SavedSearchView> {
    await owned(viewer, id);
    const body = savedSearchBody.partial().parse(input);
    if (body.name !== undefined && (await nameTaken(viewer.id, body.name, id))) throw new ConflictError(`You already have a search called “${body.name}”.`, 'NAME_TAKEN');
    await prisma.savedSearch.update({
      where: { id },
      data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.q !== undefined ? { q: body.q.trim() } : {}), ...(body.filters !== undefined ? { filters: body.filters as Prisma.InputJsonValue } : {}) },
    });
    return usable(viewer, id);
  }

  async function remove(viewer: SearchViewer, id: string): Promise<void> {
    await owned(viewer, id);
    await prisma.savedSearch.delete({ where: { id } });
  }

  /** Share with one project's team the owner runs, or stop sharing (null): everyone else's pins go. */
  async function share(viewer: SearchViewer, id: string, projectId: string | null): Promise<SavedSearchView> {
    await owned(viewer, id);
    if (projectId) {
      const runs = await deps.manageableProjectIds(viewer.id, viewer.roles, [projectId]);
      const project = runs.has(projectId) ? await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } }) : null;
      if (!project) throw new ForbiddenError('You can share a search only with the team of a project you run.');
    }
    await prisma.$transaction([
      prisma.savedSearch.update({ where: { id }, data: { projectId, sharedAt: projectId ? new Date() : null } }),
      // Unshared, or shared with another team: the old team's pins go.
      prisma.savedSearchPin.deleteMany({ where: { savedSearchId: id, userId: { not: viewer.id } } }),
    ]);
    return usable(viewer, id);
  }

  /** Pin it to the person's side menu (up to MAX_PINS), or unpin it. */
  async function pin(viewer: SearchViewer, id: string, pinned: boolean): Promise<SavedSearchList> {
    if (!pinned) {
      await prisma.savedSearchPin.deleteMany({ where: { userId: viewer.id, savedSearchId: id } });
      return list(viewer);
    }
    await usable(viewer, id);
    const now = await list(viewer);
    if (now.pinned.includes(id)) return now;
    if (now.pinned.length >= MAX_PINS) throw new ConflictError(`You can pin up to ${MAX_PINS} searches. Unpin one first.`, 'PIN_LIMIT');
    const last = await prisma.savedSearchPin.findFirst({ where: { userId: viewer.id }, orderBy: { position: 'desc' }, select: { position: true } });
    await prisma.savedSearchPin.upsert({
      where: { userId_savedSearchId: { userId: viewer.id, savedSearchId: id } },
      update: {},
      create: { userId: viewer.id, savedSearchId: id, position: (last?.position ?? -1) + 1 },
    });
    return list(viewer);
  }

  /** The projects the person may share a search with (those they run), by name. */
  async function shareOptions(viewer: SearchViewer): Promise<{ id: string; code: string; name: string }[]> {
    const allowed = await deps.accessibleProjectIds(viewer.id, viewer.roles);
    const candidates = await prisma.project.findMany({ where: { deletedAt: null, ...(allowed ? { id: { in: allowed } } : {}) }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } });
    const runs = await deps.manageableProjectIds(viewer.id, viewer.roles, candidates.map((p) => p.id));
    return candidates.filter((p) => runs.has(p.id));
  }

  return { list, usable, create, update, remove, share, pin, shareOptions };
}

export type SavedSearches = ReturnType<typeof createSavedSearches>;
