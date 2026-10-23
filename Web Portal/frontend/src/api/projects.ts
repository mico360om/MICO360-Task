import type { ApiClient } from '../lib/api-client';
import type { Priority } from './tasks';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';

export interface ApiProject {
  id: string;
  code: string;
  /** The project's own number (e.g. the client's job or contract number); null when it has none. */
  number?: string | null;
  name: string;
  description: string | null;
  clientName: string | null;
  status: ProjectStatus;
  priority: Priority;
  color: string;
  /** One of the project icons (lib/project-icons), or null for the project's initials. */
  icon?: string | null;
  imageUrl: string | null;
  ownerId: string | null;
  startDate: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A person on a project card: a face and a name. */
export interface ProjectPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** A project's card figures, counted by the server for the whole list at once. */
export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  /** Open tasks whose due day is before today (company time zone). */
  overdue: number;
  /** Nearest due day ('YYYY-MM-DD') of an open task, today or later; null when there is none. */
  nextDue: string | null;
  /** The later of the project's own last change and its latest task change (ISO). */
  lastActivityAt: string;
}

/** The Projects page's list. Under ['projects'], so a project saved anywhere refreshes it; task changes refresh it too (lib/task-cache). */
export const PROJECTS_OVERVIEW_KEY = ['projects', 'overview'] as const;

/** A project as the Projects page lists it: only what its card shows (Edit loads the full project). */
export interface ProjectOverview
  extends Pick<ApiProject, 'id' | 'code' | 'number' | 'name' | 'clientName' | 'status' | 'color' | 'icon' | 'imageUrl' | 'ownerId' | 'targetDate'> {
  stats: ProjectStats;
  owner: ProjectPerson | null;
  /** Up to four active members, in the order they joined. */
  team: ProjectPerson[];
  /** How many active members the project has. */
  teamCount: number;
  /** You own it, manage it or are on its team (worked out by the server). */
  mine: boolean;
}

export interface NewProjectInput {
  code: string;
  name: string;
  /** Up to 40 characters; null (or empty) for none. */
  number?: string | null;
  description?: string;
  clientName?: string;
  status?: ProjectStatus;
  priority?: Priority;
  color?: string;
  icon?: string | null;
  ownerId?: string | null;
}

/** Whether a code can be used for a new project (deleted projects keep theirs). */
export interface CodeCheck {
  code: string;
  valid: boolean;
  available: boolean;
  /** A free variant when the code is taken (MICO → MICO2). */
  suggestion?: string;
}

export function projectsApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiProject[] }>('/projects').then((r) => r.data),
    /** Every project you may see, with its card figures, owner and team — one request for the list. */
    overview: () => client.get<{ data: ProjectOverview[] }>('/projects/overview').then((r) => r.data),
    get: (id: string) => client.get<{ data: ApiProject }>(`/projects/${id}`).then((r) => r.data),
    /** Admin: is this code well formed and free? */
    checkCode: (code: string) => client.get<{ data: CodeCheck }>(`/projects/code-check?code=${encodeURIComponent(code)}`).then((r) => r.data),
    create: (input: NewProjectInput) => client.post<{ data: ApiProject }>('/projects', input).then((r) => r.data),
    update: (id: string, patch: Partial<NewProjectInput>) => client.put<{ data: ApiProject }>(`/projects/${id}`, patch).then((r) => r.data),
    /** Soft-archive a project (sets status ARCHIVED). */
    archive: (id: string) => client.post<{ data: ApiProject }>(`/projects/${id}/archive`, {}).then((r) => r.data),
    remove: (id: string) => client.del<void>(`/projects/${id}`),
    /** Upload a project image (admin; returns the updated project). `onProgress` hears 0–1. */
    uploadImage: (id: string, file: File | Blob, opts: { filename?: string; onProgress?: (fraction: number) => void } = {}) => {
      const form = new FormData();
      form.append('file', file, opts.filename ?? (file instanceof File ? file.name : 'project-image'));
      return client.upload<{ data: ApiProject }>(`/projects/${id}/image`, form, opts.onProgress ? { onProgress: opts.onProgress } : undefined).then((r) => r.data);
    },
    removeImage: (id: string) => client.del<{ data: ApiProject }>(`/projects/${id}/image`).then((r) => r.data),
  };
}

export const PROJECT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
export const projectStatusLabel = (s: ProjectStatus): string =>
  ({ PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' })[s];

export type ProjectsApi = ReturnType<typeof projectsApi>;
