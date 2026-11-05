/**
 * 1.23 Client accounts: where a signed-in person may be. A client account (roles exactly ['CLIENT'])
 * only ever sees the Client portal (/portal…); staff never do. These rules are used by the route
 * guards (RoleRoutes.tsx) and by sign-in (LoginRoute), so a deep link survives sign-in only when it
 * is a page of the right side.
 */

export const CLIENT_ROLE = 'CLIENT';
export const PORTAL_HOME = '/portal';
export const STAFF_HOME = '/dashboard';

/** Is this account a client account? */
export function isClientUser(user: { roles?: readonly string[] | null } | null | undefined): boolean {
  return (user?.roles ?? []).includes(CLIENT_ROLE);
}

const isPortalPath = (path: string) => path === PORTAL_HOME || path.startsWith(`${PORTAL_HOME}/`) || path.startsWith(`${PORTAL_HOME}?`);

/** A meeting invitation email links to /meetings/<id>: for a client that is the portal's meeting link. */
const INVITATION_LINK = /^\/meetings\/([^/?#]+)\/?(?:[?#].*)?$/;

/** Where a client goes for a requested address: a portal page as asked, an invitation link to its portal meeting, anything else the portal home. */
export function clientPathFor(path: string): string {
  if (isPortalPath(path)) return path;
  const invitation = INVITATION_LINK.exec(path);
  if (invitation) return `${PORTAL_HOME}/meetings/${invitation[1]}`;
  return PORTAL_HOME;
}

/** Where staff go for a requested address: any staff page as asked, never the portal. */
export function staffPathFor(path: string): string {
  return isPortalPath(path) ? STAFF_HOME : path;
}

/** After signing in: the page that was asked for, on the right side for this account. */
export function landingPathFor(user: { roles?: readonly string[] | null } | null | undefined, requested: string): string {
  return isClientUser(user) ? clientPathFor(requested) : staffPathFor(requested);
}
