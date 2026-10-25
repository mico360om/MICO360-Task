export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface ProjectRecord {
  id: string;
  code: string;
  /** The project's own number (e.g. the client's job number), free text; null when it has none. */
  number: string | null;
  name: string;
  description: string | null;
  clientName: string | null;
  managerId: string | null;
  ownerId: string | null;
  status: ProjectStatus;
  priority: Priority;
  color: string;
  /** One of PROJECT_ICONS, or null for the project's initials. */
  icon: string | null;
  imageUrl: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  notes: string | null;
  /** Each night, its unfinished tasks on past days move to today's board (see ProjectTaskSettings). */
  carryForward: boolean;
  /** A task added without a due date gets today's date (see ProjectTaskSettings). */
  defaultDueToday: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectData {
  code: string;
  number?: string | null;
  name: string;
  description?: string | null;
  clientName?: string | null;
  managerId?: string | null;
  ownerId?: string | null;
  status?: ProjectStatus;
  priority?: Priority;
  color?: string;
  icon?: string | null;
  startDate?: Date | null;
  targetDate?: Date | null;
  notes?: string | null;
  carryForward?: boolean;
  defaultDueToday?: boolean;
  createdById: string;
  /** Its team from the start, written with the project in one go (one row per person). */
  members?: NewProjectMember[];
}

/** A person put on a new project's team. */
export interface NewProjectMember {
  userId: string;
  role: 'MEMBER' | 'MANAGER';
}

export interface UpdateProjectData {
  number?: string | null;
  name?: string;
  description?: string | null;
  clientName?: string | null;
  managerId?: string | null;
  ownerId?: string | null;
  status?: ProjectStatus;
  priority?: Priority;
  color?: string;
  icon?: string | null;
  imageUrl?: string | null;
  startDate?: Date | null;
  targetDate?: Date | null;
  notes?: string | null;
  /** Absent = unchanged (older apps send updates without the task settings). */
  carryForward?: boolean;
  defaultDueToday?: boolean;
}

/** The board every new project starts with (positions 0..n, in this order). */
export const DEFAULT_COLUMNS = [
  { name: 'Backlog', category: 'BACKLOG', color: '#948985' },
  { name: 'To Do', category: 'TODO', color: '#3A6EA5' },
  { name: 'In Progress', category: 'IN_PROGRESS', color: '#B87611' },
  { name: 'Review', category: 'REVIEW', color: '#7A5AA8' },
  { name: 'Done', category: 'DONE', color: '#2E7D53' },
] as const;

export interface ProjectRepository {
  /** Create a project together with its DEFAULT_COLUMNS, in one transaction. */
  create(data: CreateProjectData): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  findByCode(code: string): Promise<ProjectRecord | null>;
  /** Whether any project — deleted ones too — has this code (the database keeps codes unique). */
  codeInUse?(code: string): Promise<boolean>;
  list(): Promise<ProjectRecord[]>;
  /** Projects a non-admin user may see: those they own, manage, created, or are a member of. */
  listForUser(userId: string): Promise<ProjectRecord[]>;
  /** True if the user owns, manages, created, or is a member of the project. */
  isAccessibleTo(projectId: string, userId: string): Promise<boolean>;
  /**
   * Change a project. `keepManager`: in the same write, make sure this person is a MANAGER member
   * (added, or promoted from MEMBER) — someone who hands over a project they run keeps running it.
   */
  update(id: string, patch: UpdateProjectData, opts?: { keepManager?: string }): Promise<ProjectRecord>;
  softDelete(id: string): Promise<void>;
}

/** Who may be picked for a project (owner, manager, team): people who are active and not deleted. */
export interface PeopleLookup {
  /** Those of `ids` who are active users, each once. */
  activeIds(ids: string[]): Promise<string[]>;
}
