import type { ExternalContactFields } from './external-contacts';

/** One external contact of a task: a person outside the company responsible for it. */
export interface ExternalContactRecord extends ExternalContactFields {
  id: string;
  taskId: string;
  /** Its place in the task's list (0 first). */
  position: number;
  /** Who added it (null once that account is removed). */
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalContactRepository {
  /** A task's contacts, in order. */
  list(taskId: string): Promise<ExternalContactRecord[]>;
  /** One contact of a live task, or null (unknown id, or its task was deleted). */
  get(contactId: string): Promise<ExternalContactRecord | null>;
  /**
   * Add a contact at the end of the task's list — or null when the task already has `max` (counted
   * in the same transaction, so two people adding at once can't go over it).
   */
  add(taskId: string, fields: ExternalContactFields, createdById: string, max: number): Promise<ExternalContactRecord | null>;
  /** Replace a contact's fields; null when it is gone. */
  update(contactId: string, fields: ExternalContactFields): Promise<ExternalContactRecord | null>;
  /** Remove a contact; false when it was already gone. */
  remove(contactId: string): Promise<boolean>;
  /**
   * Contacts on the project's live tasks whose name or company has a word starting with `prefix`
   * (case aside), the most recently saved first — at most `limit` rows, not yet one per person.
   */
  searchProject(projectId: string, prefix: string, limit: number): Promise<ExternalContactRecord[]>;
}
