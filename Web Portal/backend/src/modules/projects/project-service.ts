import { ConflictError, NotFoundError } from '../../lib/http-errors';
import type { CreateProjectData, ProjectRecord, ProjectRepository, UpdateProjectData } from './project-repository';
import { CODE_PATTERN, normalizeCode, suggestFreeCode } from './project-icons';

export interface ProjectServiceDeps {
  projects: ProjectRepository;
}

export function createProjectService({ projects }: ProjectServiceDeps) {
  /** Any project — deleted ones too — with this code. */
  const codeInUse = async (code: string) => (projects.codeInUse ? projects.codeInUse(code) : (await projects.findByCode(code)) !== null);

  async function createProject(input: CreateProjectData): Promise<ProjectRecord> {
    const code = normalizeCode(input.code);
    if (await codeInUse(code)) throw new ConflictError(`The code ${code} is already used by another project (or a deleted one).`, 'DUPLICATE_PROJECT_CODE');
    return projects.create({ ...input, code });
  }

  /** Before saving: is this code well formed and free? If taken, the first free variant. */
  async function checkCode(raw: string): Promise<{ code: string; valid: boolean; available: boolean; suggestion?: string }> {
    const code = normalizeCode(raw);
    if (!CODE_PATTERN.test(code)) return { code, valid: false, available: false };
    if (!(await codeInUse(code))) return { code, valid: true, available: true };
    const suggestion = await suggestFreeCode(code, codeInUse);
    return suggestion ? { code, valid: true, available: false, suggestion } : { code, valid: true, available: false };
  }

  async function listProjects(): Promise<ProjectRecord[]> {
    return projects.list();
  }

  const isAdmin = (roles: string[]) => roles.includes('ADMIN');

  /** Projects the caller may see: everything for an admin, else only those they belong to. */
  async function listVisibleProjects(user: { id: string; roles: string[] }): Promise<ProjectRecord[]> {
    if (isAdmin(user.roles)) return projects.list();
    return projects.listForUser(user.id);
  }

  async function getProject(id: string): Promise<ProjectRecord> {
    const project = await projects.findById(id);
    if (!project) throw new NotFoundError('Project not found.');
    return project;
  }

  /** Fetch a project only if the caller may see it; otherwise 404 (don't reveal its existence). */
  async function getVisibleProject(id: string, user: { id: string; roles: string[] }): Promise<ProjectRecord> {
    const project = await getProject(id);
    if (isAdmin(user.roles)) return project;
    if (await projects.isAccessibleTo(id, user.id)) return project;
    throw new NotFoundError('Project not found.');
  }

  async function updateProject(id: string, patch: UpdateProjectData): Promise<ProjectRecord> {
    await getProject(id);
    return projects.update(id, patch);
  }

  async function archiveProject(id: string): Promise<ProjectRecord> {
    return updateProject(id, { status: 'ARCHIVED' });
  }

  async function deleteProject(id: string): Promise<void> {
    await getProject(id);
    await projects.softDelete(id);
  }

  return { createProject, checkCode, listProjects, listVisibleProjects, getProject, getVisibleProject, updateProject, archiveProject, deleteProject };
}

export type ProjectService = ReturnType<typeof createProjectService>;
