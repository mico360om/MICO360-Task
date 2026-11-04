export interface CommentRecord {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  /** The comment this one replies to, or null for a top-level comment. */
  parentId: string | null;
  editedAt: Date | null;
  createdAt: Date;
  /** 1.23: written by a client account in the Client portal (the team sees it marked "Client"). */
  fromClient?: boolean;
  /** 1.23: a team reply to a client's comment the client may see ("Visible to client"). */
  clientVisible?: boolean;
  /** 1.23: a client's comment names its writer here (client accounts aren't in the people directory). */
  clientAuthor?: { name: string; organisation: string | null } | null;
}

/** Someone who can be @mentioned in a task's comments (shown in the suggestion list). */
export interface MentionablePerson {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

export interface CommentRepository {
  create(taskId: string, userId: string, body: string, parentId?: string | null, extra?: { fromClient?: boolean; clientVisible?: boolean }): Promise<CommentRecord>;
  findById(id: string): Promise<CommentRecord | null>;
  list(taskId: string): Promise<CommentRecord[]>;
  update(id: string, body: string): Promise<CommentRecord>;
  delete(id: string): Promise<void>;
  /**
   * Usernames of the active users who can open the task (its project's audience) — the only
   * people an @mention in its comments may notify. When absent, mentions are parsed loosely.
   */
  listMentionableUsernames?(taskId: string): Promise<string[]>;
  /** The same people, with what the suggestion list shows (name, photo). */
  listMentionable?(taskId: string): Promise<MentionablePerson[]>;
}
