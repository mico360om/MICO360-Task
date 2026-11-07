import { z } from 'zod';
import { ValidationError } from '../../lib/http-errors';
import { idString } from '../tasks/validation';

/**
 * Client accounts: per client, the projects they may open in the Client portal, and per project what
 * they may see and do there.
 *
 * 1.23.7 Granular permissions: a ROLE per project — a ladder (owner, 7 Nov 2026):
 *   Viewer       view tasks, view meetings & minutes, download reports, receive notifications
 *   Contributor  Viewer + comment, upload documents, reply to invites
 *   Approver     Contributor + sign off
 *   Custom       the ticks as given (ticking anything outside a role's set makes the row Custom)
 * A role decides the ticks on the server (what was sent with it isn't used); Custom keeps what was sent.
 *
 * The eight permissions, as stored:
 *   progress    View tasks ("Progress, milestones and tasks")       — a module
 *   meetings    View meetings & minutes                             — a module
 *   canDownload Download reports (the task list and minutes PDFs)   → needs a module
 *   canNotify   Receive notifications (the portal bell and emails)  → needs a module
 *   canComment  Comment on shared tasks                             → needs View tasks
 *   canUpload   Upload documents to shared tasks                    → needs View tasks
 *   canRespond  Reply to meeting invites (and their own action items) → needs View meetings
 *   canSignOff  Sign off finished shared tasks                      → needs View tasks
 * An action whose module is off is saved as off (turning the module on later never brings back an old
 * tick nobody sees). Custom needs at least one module.
 */
export interface GrantModules {
  progress: boolean;
  meetings: boolean;
}
export interface GrantActions {
  comment: boolean;
  signOff: boolean;
  respond: boolean;
  download: boolean;
  /** 1.23.7 */
  upload: boolean;
  /** 1.23.7 */
  notify: boolean;
}

export const CLIENT_ROLES = ['VIEWER', 'CONTRIBUTOR', 'APPROVER', 'CUSTOM'] as const;
export type ClientRoleName = (typeof CLIENT_ROLES)[number];
export type LadderRole = Exclude<ClientRoleName, 'CUSTOM'>;

export interface ClientGrant {
  projectId: string;
  /** 1.23.7: the role (Custom when none was sent: an older page's save keeps its ticks). */
  role: ClientRoleName;
  modules: GrantModules;
  actions: GrantActions;
}

/** The row as stored (client_project_grants). `role` is null only on a grant the 1.23.7 backfill hasn't reached. */
export interface GrantRow {
  projectId: string;
  role: ClientRoleName | null;
  progress: boolean;
  meetings: boolean;
  canComment: boolean;
  canSignOff: boolean;
  canRespond: boolean;
  canDownload: boolean;
  canUpload: boolean;
  canNotify: boolean;
}

/** The columns of a grant row (Prisma selects). */
export const GRANT_COLUMNS = {
  projectId: true,
  role: true,
  progress: true,
  meetings: true,
  canComment: true,
  canSignOff: true,
  canRespond: true,
  canDownload: true,
  canUpload: true,
  canNotify: true,
} as const;

export const MAX_CLIENT_PROJECTS = 200;

const NO_ACTIONS: GrantActions = { comment: false, signOff: false, respond: false, download: false, upload: false, notify: false };
const BOTH: GrantModules = { progress: true, meetings: true };

/** Each role's permissions (the ladder). */
export const CLIENT_ROLE_SETS: Readonly<Record<LadderRole, { modules: GrantModules; actions: GrantActions }>> = {
  VIEWER: { modules: BOTH, actions: { ...NO_ACTIONS, download: true, notify: true } },
  CONTRIBUTOR: { modules: BOTH, actions: { ...NO_ACTIONS, download: true, notify: true, comment: true, upload: true, respond: true } },
  APPROVER: { modules: BOTH, actions: { comment: true, signOff: true, respond: true, download: true, upload: true, notify: true } },
};

export const ROLE_WORDS: Readonly<Record<ClientRoleName, string>> = { VIEWER: 'Viewer', CONTRIBUTOR: 'Contributor', APPROVER: 'Approver', CUSTOM: 'Custom' };

const tick = z.boolean().optional().default(false);
export const grantSchema = z.object({
  projectId: idString,
  role: z.enum(CLIENT_ROLES).optional().default('CUSTOM'),
  modules: z.object({ progress: tick, meetings: tick }).default({}),
  actions: z.object({ comment: tick, signOff: tick, respond: tick, download: tick, upload: tick, notify: tick }).default({}),
});
export const grantsSchema = z.array(grantSchema).max(MAX_CLIENT_PROJECTS);

export const GRANT_WORDS = {
  noModule: 'Tick at least one of View tasks or View meetings & minutes for each project.',
  twice: 'Each project can be listed once.',
  unknownProject: 'A project in the list wasn’t found.',
} as const;

/** A grant's role (a grant from before 1.23.7, not backfilled yet, is Custom). */
export const roleOf = (r: Pick<GrantRow, 'role'>): ClientRoleName => r.role ?? 'CUSTOM';

/** One grant as stored: a role's set, or Custom's ticks without their module off. 400 when Custom has no module. */
export function grantRow(g: ClientGrant): GrantRow {
  const role: ClientRoleName = g.role ?? 'CUSTOM';
  const { modules: m, actions: a } = role === 'CUSTOM' ? { modules: g.modules, actions: { ...NO_ACTIONS, ...g.actions } } : CLIENT_ROLE_SETS[role];
  const progress = m.progress === true;
  const meetings = m.meetings === true;
  if (!progress && !meetings) throw new ValidationError(GRANT_WORDS.noModule, { field: 'projects', projectId: g.projectId });
  return {
    projectId: g.projectId,
    role,
    progress,
    meetings,
    canComment: progress && a.comment === true,
    canSignOff: progress && a.signOff === true,
    canRespond: meetings && a.respond === true,
    canDownload: a.download === true,
    canUpload: progress && a.upload === true,
    canNotify: a.notify === true,
  };
}

/** A whole list: each project once, each with a module. */
export function grantRows(grants: readonly ClientGrant[]): GrantRow[] {
  const seen = new Set<string>();
  return grants.map((g) => {
    if (seen.has(g.projectId)) throw new ValidationError(GRANT_WORDS.twice, { field: 'projects', projectId: g.projectId });
    seen.add(g.projectId);
    return grantRow(g);
  });
}

/** A stored row in the API's shape. */
export function grantOf(r: GrantRow): ClientGrant {
  return {
    projectId: r.projectId,
    role: roleOf(r),
    modules: { progress: r.progress, meetings: r.meetings },
    actions: { comment: r.canComment, signOff: r.canSignOff, respond: r.canRespond, download: r.canDownload, upload: r.canUpload === true, notify: r.canNotify === true },
  };
}

/** The permission labels, as the matrix's columns name them. */
export const PERMISSION_WORDS = {
  progress: 'View tasks',
  meetings: 'View meetings & minutes',
  download: 'Download reports',
  notify: 'Receive notifications',
  comment: 'Comment',
  upload: 'Upload documents',
  respond: 'Reply to invites',
  signOff: 'Sign off',
} as const;

/** The role and each permission in plain words (the audit log and the "Clients with access" list). */
export function grantWords(r: GrantRow): string[] {
  return [
    ROLE_WORDS[roleOf(r)],
    ...(r.progress ? [PERMISSION_WORDS.progress] : []),
    ...(r.meetings ? [PERMISSION_WORDS.meetings] : []),
    ...(r.canDownload ? [PERMISSION_WORDS.download] : []),
    ...(r.canNotify ? [PERMISSION_WORDS.notify] : []),
    ...(r.canComment ? [PERMISSION_WORDS.comment] : []),
    ...(r.canUpload ? [PERMISSION_WORDS.upload] : []),
    ...(r.canRespond ? [PERMISSION_WORDS.respond] : []),
    ...(r.canSignOff ? [PERMISSION_WORDS.signOff] : []),
  ];
}
