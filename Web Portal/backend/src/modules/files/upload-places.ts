import type { PrismaClient } from '@prisma/client';

/**
 * 1.23.39 Upload folders: the company a new file is kept under (design "Company"). A project's company is
 * its main company, else the first company it is linked to; a task's and a project channel's are their
 * project's. Null (the `shared` folder): a direct chat, or a project with no company.
 */
export interface UploadPlaces {
  companyOfProject(projectId: string): Promise<string | null>;
  companyOfTask(taskId: string): Promise<string | null>;
  companyOfConversation(conversationId: string): Promise<string | null>;
}

type Db = Pick<PrismaClient, 'project' | 'task' | 'conversation'>;

/** The company a project's files go under: its main company, else its first linked one (by id), else null. */
export function projectCompanyOf(p: { mainCompanyId: string | null; companies: { companyId: string }[] } | null): string | null {
  if (!p) return null;
  if (p.mainCompanyId) return p.mainCompanyId;
  const ids = p.companies.map((c) => c.companyId).sort();
  return ids[0] ?? null;
}

export const PROJECT_COMPANY_SELECT = { mainCompanyId: true, companies: { select: { companyId: true } } } as const;

export function createUploadPlaces(db: Db): UploadPlaces {
  const ofProject = async (projectId: string | null | undefined) =>
    projectId ? projectCompanyOf(await db.project.findUnique({ where: { id: projectId }, select: PROJECT_COMPANY_SELECT })) : null;
  return {
    companyOfProject: (projectId) => ofProject(projectId),
    async companyOfTask(taskId) {
      const t = await db.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
      return ofProject(t?.projectId);
    },
    async companyOfConversation(conversationId) {
      const c = await db.conversation.findUnique({ where: { id: conversationId }, select: { projectId: true } });
      return ofProject(c?.projectId);
    },
  };
}
