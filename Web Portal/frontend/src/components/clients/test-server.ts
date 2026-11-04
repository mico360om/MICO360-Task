import { vi } from 'vitest';
import type { ClientAccount, ClientGrant, ClientProjectOption, GrantActions, GrantModules } from '../../api/clients';
import type { ApiUser } from '../../api/users';
import type { ApiCompany } from '../../api/companies';

/**
 * A pretend server for the administrators' client screens (User Management's Role "Client", Manage
 * account on a client, the Clients page): answers the requests they send the way the real server does
 * (Web Portal/backend/src/modules/clients/client-account-routes.ts, users/user-routes.ts), and keeps
 * every request it was sent. Test code only.
 */

export interface SentRequest {
  method: string;
  /** The path after /api/v1, with its query. */
  path: string;
  body: unknown;
}

export function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export const MICO: ClientProjectOption = { id: 'p-mico', code: 'MICO', name: 'MICO Tower', company: 'Prolens Projects LLC' };
export const RIG: ClientProjectOption = { id: 'p-rig', code: 'RIG', name: 'Rig Refit', company: 'Prolens Projects LLC' };
export const FIN: ClientProjectOption = { id: 'p-fin', code: 'FIN', name: 'Finance Office', company: null };

const NO_TICKS = { modules: { progress: false, meetings: false }, actions: { comment: false, signOff: false, respond: false, download: false } };

/** A client account as the server sends it. */
export function apiClientAccount(over: Partial<ClientAccount> & Pick<ClientAccount, 'id' | 'username'>): ClientAccount {
  return {
    firstName: over.username,
    lastName: 'Client',
    email: `${over.username}@client.test`,
    organisation: null,
    phone: null,
    status: 'ACTIVE',
    locked: false,
    lastLoginAt: null,
    welcomeSentAt: null,
    createdAt: '2026-10-30T06:00:00.000Z',
    roles: ['CLIENT'],
    projects: [],
    ...over,
  };
}

/** One project on a client's account, every tick off unless given. */
export function access(p: ClientProjectOption, over: { modules?: Partial<GrantModules>; actions?: Partial<GrantActions>; archived?: boolean } = {}) {
  return {
    projectId: p.id,
    code: p.code,
    name: p.name,
    company: p.company,
    archived: over.archived ?? false,
    modules: { ...NO_TICKS.modules, ...over.modules },
    actions: { ...NO_TICKS.actions, ...over.actions },
  };
}

export interface ClientServerWorld {
  options?: ClientProjectOption[];
  clients?: ClientAccount[];
  /** Staff accounts in User Management's list. */
  staff?: ApiUser[];
  emailEnabled?: boolean;
  /** The site's companies (2+: User Management shows companies and their bulk assign). */
  companies?: ApiCompany[];
}

const asUser = (c: ClientAccount): ApiUser => ({
  id: c.id,
  email: c.email,
  username: c.username,
  firstName: c.firstName,
  lastName: c.lastName,
  avatarUrl: null,
  status: c.status,
  roles: ['CLIENT'],
  locked: c.locked,
  lastLoginAt: c.lastLoginAt,
  welcomeSentAt: c.welcomeSentAt,
  companies: [],
  primaryCompanyId: null,
});

export function clientServer(world: ClientServerWorld = {}) {
  const options = [...(world.options ?? [MICO, RIG, FIN])];
  const clients = [...(world.clients ?? [])];
  const staff = [...(world.staff ?? [])];
  const sent: SentRequest[] = [];
  const next: { method?: string; path?: RegExp; answer: () => Response }[] = [];
  let made = 0;

  /** The server's own rule: actions without their module are saved off. */
  const projectsOf = (grants: ClientGrant[]) =>
    grants.map((g) => {
      const o = options.find((x) => x.id === g.projectId) ?? clients.flatMap((c) => c.projects).find((p) => p.projectId === g.projectId);
      const progress = !!g.modules.progress;
      const meetings = !!g.modules.meetings;
      return {
        projectId: g.projectId,
        code: o && 'code' in o ? o.code : g.projectId,
        name: o?.name ?? g.projectId,
        company: o?.company ?? null,
        archived: !!(o && 'archived' in o && o.archived),
        modules: { progress, meetings },
        actions: { comment: progress && !!g.actions.comment, signOff: progress && !!g.actions.signOff, respond: meetings && !!g.actions.respond, download: (progress || meetings) && !!g.actions.download },
      };
    });
  const noModule = (grants: ClientGrant[] | undefined) => (grants ?? []).some((g) => !g.modules.progress && !g.modules.meetings);
  const NO_MODULE = json({ error: { code: 'VALIDATION', message: 'Tick at least one module for each project (Progress, milestones and tasks, or Meetings and minutes).' } }, 400);

  function answer({ method, path, body }: SentRequest): Response {
    const [route = ''] = path.split('?');
    const b = (body ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;
    if (method === 'GET' && route === '/config') return json({ data: { timeZone: 'Asia/Muscat', productName: 'MICO360 Tasks', emailEnabled: world.emailEnabled ?? true, weekStart: 0 } });
    if (method === 'GET' && route === '/me/companies') {
      const active = (world.companies ?? []).filter((c) => c.status === 'ACTIVE');
      const mine = active.map((c) => ({ id: c.id, name: c.name, code: c.code, logoUrl: c.logoUrl, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: c.effective.workingHours }));
      return json({ data: { companies: mine, primaryCompanyId: null, allArchived: false, siteCompanyCount: Math.max(1, active.length) } });
    }
    if (method === 'GET' && route === '/companies') return json({ data: world.companies ?? [] });
    if (method === 'GET' && route === '/clients/project-options') return json({ data: options });
    if (method === 'GET' && route === '/clients') return json({ data: clients });
    if (method === 'POST' && route === '/clients') {
      if (noModule(b.projects as ClientGrant[])) return NO_MODULE;
      const c = apiClientAccount({
        id: `c-new${++made}`,
        username: String(b.username),
        firstName: String(b.firstName),
        lastName: String(b.lastName),
        email: String(b.email),
        organisation: (b.organisation as string | null | undefined) || null,
        phone: (b.phone as string | null | undefined) || null,
        projects: projectsOf((b.projects as ClientGrant[]) ?? []),
        ...(b.sendWelcome ? { welcomeSentAt: '2026-11-04T08:00:00.000Z' } : {}),
      });
      clients.push(c);
      const welcome = b.sendWelcome ? { userId: c.id, username: c.username, name: `${c.firstName} ${c.lastName}`, email: c.email, sent: true, sentAt: '2026-11-04T08:00:00.000Z' } : undefined;
      return json({ data: c, ...(welcome ? { meta: { welcome } } : {}) }, 201);
    }
    if ((m = /^\/clients\/([^/]+)$/.exec(route))) {
      const i = clients.findIndex((c) => c.id === m![1]);
      if (i < 0) return json({ error: { code: 'NOT_FOUND', message: 'Client not found.' } }, 404);
      if (method === 'GET') return json({ data: clients[i] });
      if (method === 'PUT') {
        if (noModule(b.projects as ClientGrant[] | undefined)) return NO_MODULE;
        const { projects, ...details } = b as { projects?: ClientGrant[] };
        clients[i] = { ...clients[i]!, ...(details as Partial<ClientAccount>), ...(projects ? { projects: projectsOf(projects) } : {}) };
        return json({ data: clients[i] });
      }
    }
    if (method === 'GET' && route === '/users') return json({ data: [...staff, ...clients.map(asUser)] });
    if ((m = /^\/users\/([^/]+)\/status$/.exec(route)) && method === 'PATCH') {
      const c = clients.find((x) => x.id === m![1]);
      if (c) c.status = b.status as ClientAccount['status'];
      const s = staff.find((x) => x.id === m![1]);
      if (s) s.status = b.status as ApiUser['status'];
      return json({ data: c ? asUser(c) : s ?? {} });
    }
    if ((m = /^\/users\/([^/]+)$/.exec(route)) && method === 'DELETE') {
      const i = clients.findIndex((x) => x.id === m![1]);
      if (i >= 0) clients.splice(i, 1);
      return json(null, 204);
    }
    if ((m = /^\/users\/([^/]+)\/welcome-email$/.exec(route)) && method === 'POST') {
      const c = clients.find((x) => x.id === m![1]);
      if (c) c.welcomeSentAt = '2026-11-04T09:00:00.000Z';
      return json({ data: { userId: m[1], username: c?.username ?? null, name: c ? `${c.firstName} ${c.lastName}` : null, email: c?.email ?? null, sent: true, sentAt: '2026-11-04T09:00:00.000Z' } });
    }
    if ((m = /^\/users\/([^/]+)\/unlock$/.exec(route)) && method === 'POST') {
      const c = clients.find((x) => x.id === m![1]);
      if (c) c.locked = false;
      return json({ data: c ? asUser(c) : {} });
    }
    if (route === '/users/companies' && method === 'POST') {
      const ids = (b.userIds as string[]) ?? [];
      const refused = ids.filter((id) => clients.some((c) => c.id === id)).map((id) => ({ userId: id, name: id, reason: `${id} is a client account: clients can’t be added to companies, teams, tasks or chats.` }));
      return json({ data: { changed: ids.length - refused.length, refused } });
    }
    if (method === 'GET') return json({ data: [] });
    return json({ data: {} });
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      const method = init?.method ?? 'GET';
      const raw = init?.body;
      const body = typeof raw === 'string' && raw ? (JSON.parse(raw) as unknown) : undefined;
      const r: SentRequest = { method, path: u.pathname.replace(/^\/api\/v1/, '') + u.search, body };
      sent.push(r);
      const i = next.findIndex((n) => (!n.method || n.method === method) && (!n.path || n.path.test(r.path)));
      if (i >= 0) return next.splice(i, 1)[0]!.answer();
      return answer(r);
    }),
  );

  return {
    sent,
    clients,
    requests: (method: string, path: string | RegExp) => sent.filter((r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path))),
    lastBody: (method: string, path: string | RegExp) => sent.filter((r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path))).at(-1)?.body,
    /** The next matching request gets this error instead. */
    refuseNext: (status: number, code: string, message: string, match: { method?: string; path?: RegExp } = {}) => {
      next.push({ ...match, answer: () => json({ error: { code, message } }, status) });
    },
  };
}
