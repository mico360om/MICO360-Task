import { ROUTE_CLASSES } from '../companies/route-classes';

/**
 * Client accounts (1.23): what a client account's session may call — deny by default.
 *
 *   client  the Client portal: client accounts only (staff are refused, 403 CLIENTS_ONLY)
 *   both    a signed-in person's own thing a client needs too (reviewed one by one)
 *   public  no sign-in at all (sign-in itself, the share links); the session isn't looked at
 *   staff   everything else — a client's session is refused (403 CLIENT_NOT_ALLOWED), never data
 *
 * Only the client and both rows are written here. Every other route the server registers is in the
 * companies table (route-classes.ts, kept complete by its scan test) and is `public` when that table
 * says so, else `staff`. A route in neither table has no class and a client may not call it. The auth
 * guard asks this on every signed-in request (auth-guard.ts), so a route can't forget the check.
 * client-route-table.test.ts scans the source like the companies test does.
 *
 * Keys are `${METHOD} ${path exactly as written in the source}`, without the /api/v1 prefix.
 */
export type ClientRouteClass = 'client' | 'both' | 'public' | 'staff';

export const CLIENT_ROUTE_CLASSES: Readonly<Record<string, ClientRouteClass>> = {
  // ---- both: a client's own account ----------------------------------------------------------
  'POST /users/me/password': 'both',
  // 1.23 (with the 1.22.4 Error log): what a page's browser reports — a client's portal pages are pages
  // too. The routes ask for no sign-in (the companies table has them public); a session sent with a
  // report only says whose browser it was. Reading the Error log stays staff (administrators only).
  'POST /client-errors': 'both',
  'POST /client-errors/csp': 'both',

  // ---- client: the Client portal (modules/clients/portal-routes.ts) ----------------------------
  'GET /portal/me': 'client',
  'GET /portal/projects/:projectId': 'client',
  'GET /portal/projects/:projectId/tasks/:taskId': 'client',
  'POST /portal/projects/:projectId/tasks/:taskId/comments': 'client',
  'POST /portal/projects/:projectId/tasks/:taskId/accept': 'client',
  'POST /portal/projects/:projectId/tasks/:taskId/send-back': 'client',
  'GET /portal/projects/:projectId/tasks.pdf': 'client',
  'GET /portal/projects/:projectId/meetings': 'client',
  'GET /portal/projects/:projectId/meetings/:meetingId': 'client',
  'POST /portal/projects/:projectId/meetings/:meetingId/response': 'client',
  'GET /portal/projects/:projectId/meetings/:meetingId/minutes.pdf': 'client',
  'POST /portal/projects/:projectId/action-items/:itemId/done': 'client',
  'GET /portal/meetings/:meetingId': 'client',
  // 1.23.7 Granular permissions: uploads and files on shared tasks, the portal's bell and its switches.
  'POST /portal/projects/:projectId/tasks/:taskId/files': 'client',
  'GET /portal/projects/:projectId/tasks/:taskId/files/:fileId': 'client',
  'GET /portal/notifications': 'client',
  'POST /portal/notifications/:noticeId/read': 'client',
  'POST /portal/notifications/read-all': 'client',
  'GET /portal/settings/notifications': 'client',
  'PUT /portal/settings/notifications': 'client',
  // Training Center: Help & training (CLIENTS-audience published courses only; never staff courses or files).
  'GET /portal/training': 'client',
  'GET /portal/training/summary': 'client',
  'GET /portal/training/courses/:id': 'client',
  'POST /portal/training/courses/:id/start': 'client',
  'GET /portal/training/lessons/:id': 'client',
  'PUT /portal/training/lessons/:id/progress': 'client',
  'POST /portal/training/lessons/:id/complete': 'client',
  'POST /portal/training/lessons/:id/attempts': 'client',
  'PUT /portal/training/attempts/:id': 'client',
  'POST /portal/training/attempts/:id/submit': 'client',
  'GET /portal/training/attempts/:id': 'client',
  'GET /portal/training/files/:id': 'client',
  'GET /portal/training/certificates/:id/pdf': 'client',
  'POST /portal/training/courses/:id/feedback': 'client',
  'PUT /portal/training/tour': 'client',
};

const API_PREFIX = '/api/v1';

/** A registered route (method, its URL pattern as Fastify knows it) as a table key. HEAD is GET's. */
export function routeKeyOf(method: string, url: string): string {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const path = url === API_PREFIX ? '/' : url.startsWith(`${API_PREFIX}/`) ? url.slice(API_PREFIX.length) : url;
  return `${m} ${path}`;
}

/** The route's client class; undefined for a route in neither table (a client may not call it). */
export function clientRouteClass(key: string): ClientRouteClass | undefined {
  const own = CLIENT_ROUTE_CLASSES[key];
  if (own) return own;
  const company = ROUTE_CLASSES[key];
  if (!company) return undefined;
  return company === 'public' ? 'public' : 'staff';
}

/** May a client account's session be used on this route? Only the portal and the reviewed `both` rows. */
export function clientMayCall(key: string): boolean {
  const cls = clientRouteClass(key);
  return cls === 'client' || cls === 'both';
}

/** May a staff session be used on this route? Everything but the portal. */
export function staffMayCall(key: string): boolean {
  return clientRouteClass(key) !== 'client';
}
