import type { ClientGrant, ClientProjectAccess, ClientProjectOption, ClientRole, GrantActions, GrantModules } from '../../api/clients';
import type { BadgeTone } from '../ui/Badge';

/**
 * A client's project access (1.23; a permission matrix since 1.23.7), as the one editor shows it (New
 * user with Role "Client", Manage account on a client, the Clients page): per project a ROLE and eight
 * permissions, each a tick box. The roles are a ladder (owner, 7 Nov 2026) — Viewer, Contributor,
 * Approver — or Custom: picking a role ticks exactly its set; changing any tick makes the row Custom (and
 * it stays Custom even when the ticks match a role again). As on the server (client-grants.ts), an action
 * belongs to a view and does nothing without it — the server saves it off — so the editor greys it out
 * and unticks it while its view is off. A Custom row needs at least one view.
 */

export type ModuleKey = keyof GrantModules;
export type ActionKey = keyof GrantActions;
/** One of the eight permissions: a view (a module) or an action. */
export type PermissionKey = ModuleKey | ActionKey;
/** A role on the ladder (Custom is everything else). */
export type LadderRole = Exclude<ClientRole, 'CUSTOM'>;

export interface Permission {
  key: PermissionKey;
  /** The matrix's column (the server's PERMISSION_WORDS). */
  label: string;
  /** The views that open it (any one of them); none for a view itself, which is always open. */
  needs: readonly ModuleKey[];
  /** Said while it is closed. */
  hint: string | null;
}

const VIEWS: readonly ModuleKey[] = ['progress', 'meetings'];
const NEEDS_TASKS = 'Needs View tasks';
const NEEDS_MEETINGS = 'Needs View meetings & minutes';
const NEEDS_A_VIEW = 'Needs View tasks or View meetings & minutes';

/** The eight permissions, in the matrix's order. */
export const PERMISSIONS: readonly Permission[] = [
  { key: 'progress', label: 'View tasks', needs: [], hint: null },
  { key: 'meetings', label: 'View meetings & minutes', needs: [], hint: null },
  { key: 'download', label: 'Download reports', needs: VIEWS, hint: NEEDS_A_VIEW },
  { key: 'notify', label: 'Receive notifications', needs: VIEWS, hint: NEEDS_A_VIEW },
  { key: 'comment', label: 'Comment', needs: ['progress'], hint: NEEDS_TASKS },
  { key: 'upload', label: 'Upload documents', needs: ['progress'], hint: NEEDS_TASKS },
  { key: 'respond', label: 'Reply to invites', needs: ['meetings'], hint: NEEDS_MEETINGS },
  { key: 'signOff', label: 'Sign off', needs: ['progress'], hint: NEEDS_TASKS },
];

const isModule = (key: PermissionKey): key is ModuleKey => key === 'progress' || key === 'meetings';

/** The ladder, bottom first. */
export const LADDER: readonly LadderRole[] = ['VIEWER', 'CONTRIBUTOR', 'APPROVER'];

/** Each ladder role's permissions (the server's CLIENT_ROLE_SETS). */
export const ROLE_SETS: Readonly<Record<LadderRole, readonly PermissionKey[]>> = {
  VIEWER: ['progress', 'meetings', 'download', 'notify'],
  CONTRIBUTOR: ['progress', 'meetings', 'download', 'notify', 'comment', 'upload', 'respond'],
  APPROVER: ['progress', 'meetings', 'download', 'notify', 'comment', 'upload', 'respond', 'signOff'],
};

export const ROLE_WORDS: Readonly<Record<ClientRole, string>> = { VIEWER: 'Viewer', CONTRIBUTOR: 'Contributor', APPROVER: 'Approver', CUSTOM: 'Custom' };

/** The roles, in the Role select's order. */
export const ROLES: readonly { value: ClientRole; label: string }[] = [...LADDER, 'CUSTOM' as const].map((value) => ({ value, label: ROLE_WORDS[value] }));

/** A role's badge colour ("Clients with access"). */
export const ROLE_TONE: Readonly<Record<ClientRole, BadgeTone>> = { VIEWER: 'neutral', CONTRIBUTOR: 'info', APPROVER: 'success', CUSTOM: 'brand' };

const labelOf = (key: PermissionKey) => PERMISSIONS.find((p) => p.key === key)?.label ?? key;

/** What a role includes, for the legend: "Viewer, plus Comment, Upload documents, Reply to invites". */
export function roleAbout(role: ClientRole): string {
  if (role === 'CUSTOM') return 'Only the boxes you tick';
  const below = LADDER[LADDER.indexOf(role) - 1];
  const own = ROLE_SETS[role].filter((k) => !below || !ROLE_SETS[below].includes(k)).map(labelOf);
  return below ? `${ROLE_WORDS[below]}, plus ${own.join(', ')}` : own.join(', ');
}

/** One project in the editor: the grant (its role always known), and the project's name to show. */
export interface AccessRow extends ClientGrant {
  role: ClientRole;
  name: string;
  code: string;
  company: string | null;
  /** An archived project they still have: kept, but the portal doesn't show it. */
  archived: boolean;
}

/** A Custom row with neither view: its own note (the save's names the projects, in the server's words). */
export const NO_MODULE_ROW = 'Tick at least one of View tasks or View meetings & minutes.';

/**
 * The role a project just added starts with: the bottom of the ladder. It is valid as it stands (a row
 * with nothing ticked can't be saved), it sees what is shared but writes and signs off nothing, and a
 * higher role is one pick away.
 */
export const NEW_ROW_ROLE: LadderRole = 'VIEWER';

const NO_MODULES: GrantModules = { progress: false, meetings: false };
const NO_ACTIONS: GrantActions = { comment: false, signOff: false, respond: false, download: false, upload: false, notify: false };

/** Is this permission ticked? */
export function isTicked(row: Pick<ClientGrant, 'modules' | 'actions'>, key: PermissionKey): boolean {
  return isModule(key) ? row.modules[key] : row.actions[key];
}

/** May this permission be ticked with these views? The views always may. */
export function tickOpen(row: Pick<ClientGrant, 'modules'>, key: PermissionKey): boolean {
  const p = PERMISSIONS.find((x) => x.key === key);
  return !!p && (p.needs.length === 0 || p.needs.some((m) => row.modules[m]));
}

/** Only the actions their views allow stay ticked. */
function closeActions(row: AccessRow): AccessRow {
  const actions = { ...row.actions };
  for (const p of PERMISSIONS) if (!isModule(p.key) && !tickOpen(row, p.key)) actions[p.key] = false;
  return { ...row, actions };
}

/** A ladder role's ticks. */
function ticksOf(role: LadderRole): Pick<ClientGrant, 'modules' | 'actions'> {
  const modules = { ...NO_MODULES };
  const actions = { ...NO_ACTIONS };
  for (const k of ROLE_SETS[role]) {
    if (isModule(k)) modules[k] = true;
    else actions[k] = true;
  }
  return { modules, actions };
}

/** Picking a role: a ladder role ticks exactly its set; Custom keeps the ticks as they are. */
export function withRole(row: AccessRow, role: ClientRole): AccessRow {
  return role === 'CUSTOM' ? { ...row, role } : { ...row, role, ...ticksOf(role) };
}

/** "Same for all projects": every row that role. */
export function withRoleForAll(rows: readonly AccessRow[], role: ClientRole): AccessRow[] {
  return rows.map((r) => withRole(r, role));
}

/** Changing a tick makes the row Custom. A closed tick can't be ticked; a view turned off closes its actions. */
export function withTick(row: AccessRow, key: PermissionKey, on: boolean): AccessRow {
  if (on && !tickOpen(row, key)) return row;
  const next: AccessRow = isModule(key) ? { ...row, role: 'CUSTOM', modules: { ...row.modules, [key]: on } } : { ...row, role: 'CUSTOM', actions: { ...row.actions, [key]: on } };
  return closeActions(next);
}

/** A project just added: a Viewer (NEW_ROW_ROLE). */
export function newRow(p: ClientProjectOption): AccessRow {
  return { projectId: p.id, code: p.code, name: p.name, company: p.company, archived: false, role: NEW_ROW_ROLE, ...ticksOf(NEW_ROW_ROLE) };
}

/** The rows for an account's projects, as the server lists them (no role, from an older server: Custom). */
export function rowsFromAccount(projects: readonly ClientProjectAccess[]): AccessRow[] {
  return projects.map((p) => ({
    projectId: p.projectId,
    code: p.code,
    name: p.name,
    company: p.company,
    archived: p.archived,
    role: p.role ?? 'CUSTOM',
    modules: { ...NO_MODULES, ...p.modules },
    actions: { ...NO_ACTIONS, ...p.actions },
  }));
}

/** At least one view (a ladder role always has both). */
export const hasModule = (row: Pick<ClientGrant, 'modules'>) => row.modules.progress || row.modules.meetings;

/** The projects with neither view ticked (they can't be saved). */
export function rowsWithoutModule(rows: readonly AccessRow[]): AccessRow[] {
  return rows.filter((r) => !hasModule(r));
}

/** "Tick at least one of View tasks or View meetings & minutes for MICO Tower and Rig Refit." (none named: "for each project", as the server). */
export function noModuleText(missing: readonly Pick<AccessRow, 'name'>[]): string {
  const names = missing.map((r) => r.name);
  const list = names.length === 0 ? 'each project' : names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Tick at least one of View tasks or View meetings & minutes for ${list}.`;
}

/** Why "Preview as client" can't open yet (null: it can). */
export function previewBlocked(rows: readonly AccessRow[]): string | null {
  if (rows.length === 0) return 'Add a project to preview what they would see.';
  if (rowsWithoutModule(rows).length > 0) return 'Tick a view on each project to preview.';
  return null;
}

/** What is sent to the server: each project's role and every tick (a ladder role's own set; an action without its view off). */
export function grantsOf(rows: readonly AccessRow[]): ClientGrant[] {
  return rows.map((r) => {
    const ticks = r.role === 'CUSTOM' ? closeActions(r) : ticksOf(r.role);
    return { projectId: r.projectId, role: r.role, modules: { ...ticks.modules }, actions: { ...ticks.actions } };
  });
}

/** Did the access change (projects, a role, or any tick)? Order doesn't matter. */
export function grantsChanged(before: readonly AccessRow[], after: readonly AccessRow[]): boolean {
  const key = (rows: readonly AccessRow[]) =>
    JSON.stringify(
      grantsOf(rows)
        .map((g) => [g.projectId, g.role ?? 'CUSTOM', PERMISSIONS.map((p) => isTicked(g, p.key))] as const)
        // Ids, not words: a plain code-unit order (the same in every browser).
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    );
  return key(before) !== key(after);
}

/** The plain words for a project's access: the role word first, then each permission ("Viewer", "View tasks", …). */
export function accessWords(row: Pick<ClientGrant, 'role' | 'modules' | 'actions'>): string[] {
  return [ROLE_WORDS[row.role ?? 'CUSTOM'], ...PERMISSIONS.filter((p) => isTicked(row, p.key) && tickOpen(row, p.key)).map((p) => p.label)];
}

/** "1 project" / "3 projects". */
export const projectCount = (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`;
