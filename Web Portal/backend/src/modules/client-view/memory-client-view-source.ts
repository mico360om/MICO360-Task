import { isTaskDone } from '../tasks/task-status';
import type { ClientMinutesSource, ClientProjectSource, ClientTaskSource } from './client-view-payload';
import type { ClientViewSource } from './client-view-source';

/** An in-memory client view source with the Prisma one's rules (unit tests). */
export interface MemoryClientViewSource extends ClientViewSource {
  addProject(id: string, p: ClientProjectSource): void;
  setStatus(id: string, status: string): void;
  setGone(id: string): void;
  addTask(projectId: string, t: ClientTaskSource): void;
  addMinutes(projectId: string, m: ClientMinutesSource): void;
}

export function createMemoryClientViewSource(): MemoryClientViewSource {
  const projects = new Map<string, ClientProjectSource & { gone: boolean }>();
  const tasks: Array<ClientTaskSource & { projectId: string }> = [];
  const minutes: Array<ClientMinutesSource & { projectId: string }> = [];
  const shown = (projectId: string) => minutes.filter((m) => m.projectId === projectId && m.status === 'APPROVED' && m.clientVisible);
  const strip = ({ projectId: _p, ...m }: ClientMinutesSource & { projectId: string }): ClientMinutesSource => m;
  return {
    addProject: (id, p) => void projects.set(id, { ...p, gone: false }),
    setStatus: (id, status) => void (projects.get(id)!.status = status),
    setGone: (id) => void (projects.get(id)!.gone = true),
    addTask: (projectId, t) => void tasks.push({ ...t, projectId }),
    addMinutes: (projectId, m) => void minutes.push({ ...m, projectId }),
    async project(id) {
      const p = projects.get(id);
      return p ? { ...p } : null;
    },
    async counts(projectId) {
      const mine = tasks.filter((t) => t.projectId === projectId);
      return { total: mine.length, done: mine.filter((t) => isTaskDone(t)).length };
    },
    async items(projectId) {
      return tasks.filter((t) => t.projectId === projectId && t.clientVisible).map(({ projectId: _p, ...t }) => t);
    },
    async minutes(projectId) {
      return shown(projectId).map(strip);
    },
    async minutesOf(projectId, meetingId) {
      const m = shown(projectId).find((x) => x.meetingId === meetingId);
      return m ? strip(m) : null;
    },
  };
}
