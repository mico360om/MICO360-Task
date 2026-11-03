import { vi } from 'vitest';
import type { ApiCompany, CompanyPeopleChange, CompanyPerson, CompanyProject, MyCompanies } from '../api/companies';
import type { ApiUser } from '../api/users';

/**
 * A pretend server for the administrators' company screens (the Companies page, User Management):
 * answers the requests those screens send, the way the real server does
 * (Web Portal/backend/src/modules/companies/company-routes.ts, users/user-routes.ts), and keeps
 * every request it was sent. Test code only.
 */

export interface SentRequest {
  method: string;
  /** The path after /api/v1, with its query ("/users?companyId=a"). */
  path: string;
  /** The JSON body, or the FormData of an upload. */
  body: unknown;
  headers: Record<string, string>;
}

export const SITE_HOURS = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };

export function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function apiCompany(over: Partial<ApiCompany> & Pick<ApiCompany, 'id' | 'name' | 'code'>): ApiCompany {
  const weekStart = over.weekStart ?? null;
  const workingHours = over.workingHours ?? null;
  const senderName = over.senderName ?? null;
  return {
    logoUrl: null,
    timeZone: null,
    status: 'ACTIVE',
    archivedAt: null,
    createdAt: '2026-10-01T06:00:00.000Z',
    counts: { people: 3, projects: 2 },
    ...over,
    weekStart,
    workingHours,
    senderName,
    effective: { timeZone: 'Asia/Muscat', weekStart: weekStart ?? 0, workingHours: workingHours ?? SITE_HOURS, senderName: senderName ?? 'MICO360 Tasks' },
  };
}

/** A user as User Management lists them, with their companies (from 1.21). */
export type ListedUser = ApiUser & { companies?: { id: string; name: string; code: string }[]; primaryCompanyId?: string | null };

export function apiUser(over: Partial<ListedUser> & Pick<ApiUser, 'id' | 'username'>): ListedUser {
  return { email: `${over.username}@x.co`, firstName: over.username, lastName: '', avatarUrl: null, status: 'ACTIVE', roles: ['EMPLOYEE'], lastLoginAt: null, welcomeSentAt: null, ...over };
}

export interface CompanyServerWorld {
  companies?: ApiCompany[];
  people?: Record<string, CompanyPerson[]>;
  projects?: Record<string, CompanyProject[]>;
  users?: ListedUser[];
  my?: Partial<MyCompanies>;
  emailEnabled?: boolean;
  /** The site's week start (/config). */
  weekStart?: 0 | 1 | 6;
}

export function companyServer(world: CompanyServerWorld = {}) {
  const companies = [...(world.companies ?? [])];
  const people = { ...(world.people ?? {}) };
  const users = [...(world.users ?? [])];
  const sent: SentRequest[] = [];
  const next: { method?: string; path?: RegExp; answer: () => Response }[] = [];
  let made = 0;

  const company = (id: string) => companies.find((c) => c.id === id);
  const replace = (c: ApiCompany) => {
    companies.splice(companies.findIndex((x) => x.id === c.id), 1, c);
    return json({ data: c });
  };

  function answer(r: SentRequest): Response {
    const { method, path, body } = r;
    const [route = '', query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    const b = (body ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;
    if (method === 'GET' && route === '/config') {
      return json({ data: { timeZone: 'Asia/Muscat', productName: 'MICO360 Tasks', companyName: 'MICO360', serverTime: new Date().toISOString(), emailEnabled: world.emailEnabled ?? true, weekStart: world.weekStart ?? 0 } });
    }
    if (method === 'GET' && route === '/system-settings') return json({ data: [{ key: 'meetings.workingHours', value: SITE_HOURS }] });
    if (method === 'GET' && route === '/me/companies') {
      // An administrator's: every active company, A–Z.
      const active = companies.filter((c) => c.status === 'ACTIVE').sort((a, b) => a.name.localeCompare(b.name, 'en'));
      const mine = active.map((c) => ({ id: c.id, name: c.name, code: c.code, logoUrl: c.logoUrl, timeZone: 'Asia/Muscat', weekStart: c.effective.weekStart, workingHours: c.effective.workingHours }));
      return json({ data: { companies: mine, primaryCompanyId: null, allArchived: false, siteCompanyCount: active.length, ...world.my } });
    }
    if (route === '/companies') {
      if (method === 'GET') return json({ data: companies });
      if (method === 'POST') {
        const created = apiCompany({ id: `new${++made}`, name: String(b.name), code: String(b.code).toUpperCase(), counts: { people: 0, projects: 0 } });
        companies.push(created);
        return json({ data: created }, 201);
      }
    }
    if ((m = /^\/companies\/([^/]+)$/.exec(route))) {
      const c = company(m[1]!);
      if (!c) return json({ error: { code: 'NOT_FOUND', message: 'Company not found.' } }, 404);
      if (method === 'GET') return json({ data: c });
      if (method === 'PUT') return replace(apiCompany({ ...c, ...(b as Partial<ApiCompany>) }));
    }
    if ((m = /^\/companies\/([^/]+)\/(logo|archive|unarchive|people|projects)$/.exec(route))) {
      const c = company(m[1]!);
      if (!c) return json({ error: { code: 'NOT_FOUND', message: 'Company not found.' } }, 404);
      const what = m[2];
      if (what === 'logo' && method === 'POST') return replace({ ...c, logoUrl: `/uploads/logo-${c.id}.png` });
      if (what === 'logo' && method === 'DELETE') return replace({ ...c, logoUrl: null });
      if (what === 'archive') return replace({ ...c, status: 'ARCHIVED', archivedAt: '2026-10-30T08:00:00.000Z' });
      if (what === 'unarchive') return replace({ ...c, status: 'ACTIVE', archivedAt: null });
      if (what === 'people' && method === 'GET') return json({ data: people[c.id] ?? [] });
      if (what === 'people' && method === 'POST') {
        const ids = (b.userIds as string[]) ?? [];
        return json({ data: { changed: ids.length, refused: [] } satisfies CompanyPeopleChange });
      }
      if (what === 'projects') return json({ data: world.projects?.[c.id] ?? [] });
    }
    if ((m = /^\/companies\/([^/]+)\/people\/([^/]+)$/.exec(route)) && method === 'DELETE') {
      people[m[1]!] = (people[m[1]!] ?? []).filter((p) => p.id !== m![2]);
      return json(null, 204);
    }
    if (route === '/users' && method === 'GET') {
      const id = params.get('companyId');
      const list = id === null ? users : users.filter((u) => (id === 'none' ? !(u.companies ?? []).length : (u.companies ?? []).some((c) => c.id === id)));
      return json({ data: list });
    }
    if (route === '/users' && method === 'POST') return json({ data: apiUser({ id: 'made', username: String(b.username) }) }, 201);
    if ((m = /^\/users\/([^/]+)$/.exec(route)) && method === 'PUT') {
      const u = users.find((x) => x.id === m![1]) ?? apiUser({ id: m[1]!, username: m[1]! });
      return json({ data: { ...u, ...(b as Partial<ApiUser>) } });
    }
    if (route === '/users/companies' && method === 'POST') return json({ data: { changed: ((b.userIds as string[]) ?? []).length, refused: [] } });
    if (method === 'GET') return json({ data: [] });
    return json({ data: {} });
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      const method = init?.method ?? 'GET';
      const raw = init?.body;
      const body = raw instanceof FormData ? raw : typeof raw === 'string' && raw ? (JSON.parse(raw) as unknown) : undefined;
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      const r: SentRequest = { method, path: u.pathname.replace(/^\/api\/v1/, '') + u.search, body, headers };
      sent.push(r);
      const at = next.findIndex((n) => (n.method ?? r.method) === r.method && (!n.path || n.path.test(r.path)) && (n.method !== undefined || r.method !== 'GET'));
      if (at >= 0) return next.splice(at, 1)[0]!.answer();
      return answer(r);
    }),
  );

  return {
    sent,
    companies,
    /** The next change (or the next `method` request to a path matching `path`) is refused with these words. */
    refuseNext(status: number, code: string, message: string, match: { method?: string; path?: RegExp } = {}) {
      next.push({ ...match, answer: () => json({ error: { code, message } }, status) });
    },
    /** The next `method` request to a path matching `path` gets this answer. */
    answerNext(method: string, path: RegExp, body: unknown, status = 200) {
      next.push({ method, path, answer: () => json(body, status) });
    },
    /** The requests with this method and path (query included). */
    requests(method: string, path: string) {
      return sent.filter((r) => r.method === method && r.path === path);
    },
    /** The body of the last request with this method and path. */
    lastBody(method: string, path: string) {
      return sent.filter((r) => r.method === method && r.path === path).at(-1)?.body;
    },
    /** The paths of every GET to this route (query included), in order. */
    gets(route: string) {
      return sent.filter((r) => r.method === 'GET' && r.path.split('?')[0] === route).map((r) => r.path);
    },
  };
}
