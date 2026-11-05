import type { ClientGrant, ClientProjectAccess, ClientProjectOption, GrantActions, GrantModules } from '../../api/clients';

/**
 * A client's project access (1.23), as the one editor shows it (New user with Role "Client", Manage
 * account on a client, the Clients page): per project two modules and four actions, each a tick box,
 * all off until ticked, at least one module. An action belongs to a module and does nothing without
 * it — the server saves it off — so the editor greys it out and unticks it while its module is off.
 */

export type ModuleKey = keyof GrantModules;
export type ActionKey = keyof GrantActions;

export const MODULES: readonly { key: ModuleKey; label: string }[] = [
  { key: 'progress', label: 'Progress, milestones and tasks' },
  { key: 'meetings', label: 'Meetings and minutes' },
];

/** Each action, the modules that open it (any one of them), and the short hint shown while it is closed. */
export const ACTIONS: readonly { key: ActionKey; label: string; needs: readonly ModuleKey[]; hint: string }[] = [
  { key: 'comment', label: 'Comment on tasks', needs: ['progress'], hint: 'Needs Progress' },
  { key: 'signOff', label: 'Sign off finished tasks', needs: ['progress'], hint: 'Needs Progress' },
  { key: 'respond', label: 'Reply to meeting invites (and their own action items)', needs: ['meetings'], hint: 'Needs Meetings' },
  { key: 'download', label: 'Download PDFs', needs: ['progress', 'meetings'], hint: 'Needs a module' },
];

/** One project in the editor: the grant, and the project's name to show. */
export interface AccessRow extends ClientGrant {
  name: string;
  code: string;
  company: string | null;
  /** An archived project they still have: kept, but the portal doesn't show it. */
  archived: boolean;
}

export const NO_MODULE_ROW = 'Tick at least one module.';

const NONE: Pick<ClientGrant, 'modules' | 'actions'> = {
  modules: { progress: false, meetings: false },
  actions: { comment: false, signOff: false, respond: false, download: false },
};

/** May this action be ticked with these modules? */
export function actionOpen(modules: GrantModules, key: ActionKey): boolean {
  const action = ACTIONS.find((a) => a.key === key);
  return !!action && action.needs.some((m) => modules[m]);
}

/** A project just added: every tick off. */
export function newRow(p: ClientProjectOption): AccessRow {
  return { projectId: p.id, code: p.code, name: p.name, company: p.company, archived: false, modules: { ...NONE.modules }, actions: { ...NONE.actions } };
}

/** The rows for an account's projects, as the server lists them. */
export function rowsFromAccount(projects: readonly ClientProjectAccess[]): AccessRow[] {
  return projects.map((p) => ({
    projectId: p.projectId,
    code: p.code,
    name: p.name,
    company: p.company,
    archived: p.archived,
    modules: { ...p.modules },
    actions: { ...p.actions },
  }));
}

/** Only the actions their modules allow stay ticked. */
function closeActions(row: AccessRow): AccessRow {
  const actions = { ...row.actions };
  for (const a of ACTIONS) if (!actionOpen(row.modules, a.key)) actions[a.key] = false;
  return { ...row, actions };
}

export function withModule(row: AccessRow, key: ModuleKey, on: boolean): AccessRow {
  return closeActions({ ...row, modules: { ...row.modules, [key]: on } });
}

export function withAction(row: AccessRow, key: ActionKey, on: boolean): AccessRow {
  if (on && !actionOpen(row.modules, key)) return row;
  return { ...row, actions: { ...row.actions, [key]: on } };
}

export const hasModule = (row: Pick<ClientGrant, 'modules'>) => row.modules.progress || row.modules.meetings;

/** The projects with no module ticked (they can't be saved). */
export function rowsWithoutModule(rows: readonly AccessRow[]): AccessRow[] {
  return rows.filter((r) => !hasModule(r));
}

/** "Tick at least one module for MICO Tower and Rig Refit: Progress, milestones and tasks, or Meetings and minutes." */
export function noModuleText(missing: readonly Pick<AccessRow, 'name'>[]): string {
  const names = missing.map((r) => r.name);
  const list = names.length <= 1 ? (names[0] ?? 'each project') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Tick at least one module for ${list}: Progress, milestones and tasks, or Meetings and minutes.`;
}

/** What is sent to the server: each project's ticks, actions without their module off. */
export function grantsOf(rows: readonly AccessRow[]): ClientGrant[] {
  return rows.map((r) => {
    const closed = closeActions(r);
    return { projectId: r.projectId, modules: { ...closed.modules }, actions: { ...closed.actions } };
  });
}

/** Did the access change (projects, or any tick)? Order doesn't matter. */
export function grantsChanged(before: readonly AccessRow[], after: readonly AccessRow[]): boolean {
  const key = (rows: readonly AccessRow[]) =>
    JSON.stringify(
      grantsOf(rows)
        .map((g) => [g.projectId, MODULES.map((m) => g.modules[m.key]), ACTIONS.map((a) => g.actions[a.key])])
        // Ids, not words: a plain code-unit order (the same in every browser).
        .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0)),
    );
  return key(before) !== key(after);
}

/** The plain words for what a project's access lets them see and do: "Progress, Meetings · Comment, Download PDFs". */
export function accessWords(row: Pick<ClientGrant, 'modules' | 'actions'>): string[] {
  return [
    ...MODULES.filter((m) => row.modules[m.key]).map((m) => m.label),
    ...ACTIONS.filter((a) => row.actions[a.key] && actionOpen(row.modules, a.key)).map((a) => a.label),
  ];
}

/** "1 project" / "3 projects". */
export const projectCount = (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`;
