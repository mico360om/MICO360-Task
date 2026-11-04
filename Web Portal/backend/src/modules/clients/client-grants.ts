import { z } from 'zod';
import { ValidationError } from '../../lib/http-errors';
import { idString } from '../tasks/validation';

/**
 * 1.23 Client accounts: per client, the projects they may open in the Client portal, and per project
 * two modules and four actions — each a tick box, all off until ticked, at least one module.
 *
 * Each action belongs to a module and does nothing without it, so an action whose module is off is
 * saved as off (turning the module on later never brings back an old tick nobody sees):
 *   comment, signOff → "Progress, milestones and tasks"
 *   respond          → "Meetings and minutes"
 *   download         → either (the task list PDF with Progress, the minutes PDF with Meetings)
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
}
export interface ClientGrant {
  projectId: string;
  modules: GrantModules;
  actions: GrantActions;
}

/** The row as stored (client_project_grants). */
export interface GrantRow {
  projectId: string;
  progress: boolean;
  meetings: boolean;
  canComment: boolean;
  canSignOff: boolean;
  canRespond: boolean;
  canDownload: boolean;
}

export const MAX_CLIENT_PROJECTS = 200;

const tick = z.boolean().optional().default(false);
export const grantSchema = z.object({
  projectId: idString,
  modules: z.object({ progress: tick, meetings: tick }).default({}),
  actions: z.object({ comment: tick, signOff: tick, respond: tick, download: tick }).default({}),
});
export const grantsSchema = z.array(grantSchema).max(MAX_CLIENT_PROJECTS);

export const GRANT_WORDS = {
  noModule: 'Tick at least one module for each project (Progress, milestones and tasks, or Meetings and minutes).',
  twice: 'Each project can be listed once.',
  unknownProject: 'A project in the list wasn’t found.',
} as const;

/** One grant as stored: actions without their module off. 400 when no module is ticked. */
export function grantRow(g: ClientGrant): GrantRow {
  const progress = g.modules.progress === true;
  const meetings = g.modules.meetings === true;
  if (!progress && !meetings) throw new ValidationError(GRANT_WORDS.noModule, { field: 'projects', projectId: g.projectId });
  return {
    projectId: g.projectId,
    progress,
    meetings,
    canComment: progress && g.actions.comment === true,
    canSignOff: progress && g.actions.signOff === true,
    canRespond: meetings && g.actions.respond === true,
    canDownload: (progress || meetings) && g.actions.download === true,
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
    modules: { progress: r.progress, meetings: r.meetings },
    actions: { comment: r.canComment, signOff: r.canSignOff, respond: r.canRespond, download: r.canDownload },
  };
}

/** The four actions in plain words (the audit log and the "Clients with access" list). */
export function grantWords(r: GrantRow): string[] {
  return [
    ...(r.progress ? ['Progress, milestones and tasks'] : []),
    ...(r.meetings ? ['Meetings and minutes'] : []),
    ...(r.canComment ? ['Comment on tasks'] : []),
    ...(r.canSignOff ? ['Sign off finished tasks'] : []),
    ...(r.canRespond ? ['Reply to meeting invites'] : []),
    ...(r.canDownload ? ['Download PDFs'] : []),
  ];
}
