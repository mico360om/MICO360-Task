export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface ProjectRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  clientName: string | null;
  managerId: string | null;
  ownerId: string | null;
  status: ProjectStatus;
  priority: Priority;
  color: string;
  imageUrl: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  notes: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectData {
  code: string;
  name: string;
  description?: string | null;
  clientName?: string | null;
  managerId?: string | null;
  ownerId?: string | null;
  status?: ProjectStatus;
  priority?: Priority;
  color?: string;
  startDate?: Date | null;
  targetDate?: Date | null;
  notes?: string | null;
  createdById: string;
}

export interface UpdateProjectData {
  name?: string;
  description?: string | null;
  clientName?: string | null;
  managerId?: string | null;
  ownerId?: string | null;
  status?: ProjectStatus;
  priority?: Priority;
  color?: string;
  imageUrl?: string | null;
  startDate?: Date | null;
  targetDate?: Date | null;
  notes?: string | null;
}

export interface ProjectRepository {
  create(data: CreateProjectData): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  findByCode(code: string): Promise<ProjectRecord | null>;
  list(): Promise<ProjectRecord[]>;
  /** Projects a non-admin user may see: those they own, manage, created, or are a member of. */
  listForUser(userId: string): Promise<ProjectRecord[]>;
  /** True if the user owns, manages, created, or is a member of the project. */
  isAccessibleTo(projectId: string, userId: string): Promise<boolean>;
  update(id: string, patch: UpdateProjectData): Promise<ProjectRecord>;
  softDelete(id: string): Promise<void>;
}
