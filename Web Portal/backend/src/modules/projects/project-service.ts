import { ConflictError, NotFoundError } from '../../lib/http-errors';
import type { CreateProjectData, ProjectRecord, ProjectRepository, UpdateProjectData } from './project-repository';

export interface ProjectServiceDeps {
  projects: ProjectRepository;
}

export function createProjectService({ projects }: ProjectServiceDeps) {
  async function createProject(input: CreateProjectData): Promise<ProjectRecord> {
    const existing = await projects.findByCode(input.code);
    if (existing) throw new ConflictError('A project with this code already exists.', 'DUPLICATE_PROJECT_CODE');
    return projects.create(input);
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

  return { createProject, listProjects, listVisibleProjects, getProject, getVisibleProject, updateProject, archiveProject, deleteProject };
}

export type ProjectService = ReturnType<typeof createProjectService>;
