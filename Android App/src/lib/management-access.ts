/**
 * Who may see the Management page (the website's useManagementAccess): administrators, and the
 * people the server says run a project (GET /management/access). Asked per person — a shared phone
 * never shows the next person what the last one could see — and "no" until the server says yes.
 * Pure TypeScript; the query is in core/management-queries.
 */

/** The access query's key: one per person ('' when signed out). */
export function managementAccessKey(userId: string | null | undefined): readonly ['management-access', string] {
  return ['management-access', userId ?? ''] as const;
}

/** May they open Management? An administrator always; anyone else only on the server's `allowed: true`. */
export function managementAccessOf(isAdmin: boolean, data: { allowed?: unknown } | null | undefined): boolean {
  if (isAdmin) return true;
  return data?.allowed === true;
}
