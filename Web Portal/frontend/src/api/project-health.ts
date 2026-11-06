import type { ApiClient } from '../lib/api-client';
import type { ApiActivity } from './activity';
import type { PrioritiesAnswer } from './dashboard';
import type { Rag, RagReason } from './management';
import type { ProjectCompletion } from './projects';

/**
 * 1.23.5 Project overview & health — the project page's Overview: its health with every reason,
 * completion both ways, the automatic risks with who is accountable, the accountable owners
 * (GET /projects/:id/health); its Next actions in the 1.23.4 list's shape (GET /projects/:id/next-actions);
 * and its Recent activity (GET /projects/:id/activity).
 */

export interface HealthPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ProjectRisk {
  code: 'MILESTONE_LATE' | 'MILESTONE_AT_RISK' | 'WORKLOAD' | 'BLOCKED' | 'OVERDUE' | 'UNASSIGNED' | 'NO_ACTIVITY';
  level: 'RED' | 'AMBER';
  title: string;
  detail: string;
  accountable: HealthPerson[];
  tasks: { id: string; key: string; title: string }[];
}

export interface ProjectHealthDetail {
  projectId: string;
  rag: Rag;
  reasons: RagReason[];
  completion: ProjectCompletion & { total: number; done: number; weightTotal: number; weightDone: number };
  timeUsedPct: number | null;
  risks: ProjectRisk[];
  owners: {
    owner: HealthPerson | null;
    managers: HealthPerson[];
    milestones: { id: string; key: string; title: string; due: string | null; owners: HealthPerson[] }[];
  };
  generatedAt: string;
}

export const projectHealthKey = (projectId: string) => ['project-health', projectId] as const;
export const nextActionsKey = (projectId: string) => ['project-next-actions', projectId] as const;
export const projectActivityKey = (projectId: string) => ['project-activity', projectId] as const;

export function projectHealthApi(client: ApiClient) {
  return {
    health: (projectId: string) => client.get<{ data: ProjectHealthDetail }>(`/projects/${encodeURIComponent(projectId)}/health`).then((r) => r.data),
    /** `fresh`: right after the person's own change (the server's 60-second copy is skipped). */
    nextActions: (projectId: string, fresh = false) =>
      client.get<{ data: PrioritiesAnswer }>(`/projects/${encodeURIComponent(projectId)}/next-actions${fresh ? '?fresh=1' : ''}`).then((r) => r.data),
    activity: (projectId: string) => client.get<{ data: ApiActivity[] }>(`/projects/${encodeURIComponent(projectId)}/activity`).then((r) => r.data),
  };
}
