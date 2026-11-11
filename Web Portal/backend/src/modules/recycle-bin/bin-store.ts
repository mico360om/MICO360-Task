/** A person as the Recycle Bin names them. */
export interface BinPerson {
  id: string;
  name: string;
}

/** A deleted task's project, as the bin shows it. */
export interface BinProject {
  id: string;
  name: string;
  code: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
}

/** One deleted task in the bin (what the list reads; the service filters, sorts and words it). */
export interface BinRow {
  id: string;
  key: string;
  title: string;
  description: string | null;
  /** Its numbers from before it moved project (a number search finds it by them too). */
  formerKeys: string[];
  project: BinProject;
  /** The project's companies (the company filter on a site with several). */
  companyIds: string[];
  /** Its column when it was deleted. */
  status: { name: string; category: string };
  deletedAt: Date;
  deletedById: string | null;
  binExpiresAt: Date | null;
  deleteBatchId: string | null;
  assignees: BinPerson[];
}

/** A task that is in the Recycle Bin: deleted, not merged, in a project that is still there. */
export interface BinnedTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  deletedAt: Date;
  deletedById: string | null;
  binExpiresAt: Date | null;
  deleteBatchId: string | null;
}

/** A task erased for good: what the audit log keeps, and its files (removed from disk when nothing else uses them). */
export interface ErasedTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  files: string[];
}

/** One line of a deleted task's history (as GET /tasks/:id/activity gives it). */
export interface BinHistoryLine {
  id: string;
  taskId: string | null;
  projectId: string | null;
  userId: string;
  action: string;
  meta: unknown;
  createdAt: Date;
  actor: BinPerson | null;
}

export interface BinComment {
  id: string;
  author: BinPerson | null;
  /** Empty for a deleted comment (it still holds its replies). */
  body: string;
  deleted: boolean;
  fromClient: boolean;
  createdAt: Date;
  editedAt: Date | null;
  replies: Omit<BinComment, 'replies'>[];
}

/** Everything a deleted task had, read-only (the bin's view of it before restoring). */
export interface BinDetail {
  task: {
    id: string;
    key: string;
    title: string;
    description: string | null;
    priority: string;
    startDate: Date | null;
    dueDate: Date | null;
    isMilestone: boolean;
    repeats: boolean;
    createdAt: Date;
    createdBy: BinPerson | null;
    formerKeys: string[];
    project: BinProject;
    status: { name: string; category: string };
  };
  assignees: BinPerson[];
  tags: { name: string; color: string }[];
  /** Its guests (1.24; the rows keep each guest's name and company), in their order. */
  contacts: { name: string; company: string | null }[];
  /** 1.24: its categories, in their project's order (a retired one says so). */
  categories: { id: string; name: string; color: string; retired: boolean }[];
  checklists: { title: string; items: { text: string; done: boolean; depth: number }[] }[];
  comments: BinComment[];
  files: { filename: string; sizeBytes: number; createdAt: Date; uploadedBy: BinPerson | null }[];
  /** Its blockers that are still there, with their projects (the service keeps those the person may open). */
  blockers: { key: string; title: string; projectId: string }[];
  history: BinHistoryLine[];
}

/** The Recycle Bin's reads and writes (Prisma: prisma-bin-store.ts). */
export interface BinStore {
  /** Deleted tasks in live projects (these projects; null = every one), newest first. */
  list(projectIds: string[] | null): Promise<BinRow[]>;
  /** Names of these people (deleted accounts too). */
  people(ids: string[]): Promise<BinPerson[]>;
  /** How many tasks of each batch are still in the bin. */
  batchSizes(batchIds: string[]): Promise<Map<string, number>>;
  /** One task, if it is in the bin. */
  find(id: string): Promise<BinnedTask | null>;
  /** These tasks' numbers, titles and projects (whatever their state). */
  facts(ids: string[]): Promise<{ id: string; key: string; title: string; projectId: string }[]>;
  /** The tasks of a batch still in the bin. */
  inBatch(batchId: string): Promise<BinnedTask[]>;
  /** Everything a task in the bin had, or null. */
  detail(id: string): Promise<BinDetail | null>;
  /** Bring it back as it was; true when this call did (false: not in the bin any more). */
  restore(id: string): Promise<boolean>;
  /** Erase a deleted task for good (any deleted, unmerged task: the sweep's too); null when it isn't one. */
  erase(id: string): Promise<ErasedTask | null>;
  /** Is this file still used by anything (a task, a chat message, a meeting note, a decision)? */
  fileInUse(storageKey: string): Promise<boolean>;
  /** Deleted tasks whose 60 days are over (in any project), at most `limit`, leaving out `skip`. */
  due(now: Date, limit: number, skip?: string[]): Promise<string[]>;
  /** Does this person run this project (owner, named manager, MANAGER member, sharing one of its companies)? */
  runsProject(userId: string, projectId: string): Promise<boolean>;
  /** The live projects this person runs, in the picked company (null: all of theirs). */
  runProjectIds(userId: string, pick: string | null): Promise<string[]>;
  /** Does this person run any live project at all? */
  runsAny(userId: string): Promise<boolean>;
}
