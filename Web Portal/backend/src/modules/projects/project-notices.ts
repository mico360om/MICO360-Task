import type { Logger } from '../../lib/logger';
import type { CreateNotificationData } from '../notifications/notification-repository';

/** The in-app notice someone gets when they are put on a project (muted with this type in Settings). */
export const PROJECT_ADDED = 'PROJECT_ADDED';

export interface ProjectNoticeDeps {
  /** The notification service's notify: honours each person's muted types, and pushes to phones. */
  notify: (n: CreateNotificationData) => Promise<unknown>;
  /** A person's display name ("Omar Ahmed"). */
  nameOf: (userId: string) => Promise<string>;
  /** A project's name, for people added later. */
  projectName: (projectId: string) => Promise<string>;
  logger?: Pick<Logger, 'error'>;
}

/**
 * Telling people they've been put on a project: "{who} made you the owner of {project}" for its
 * owner, "{who} added you to the project {project}" for the rest of its team — on creation, and for
 * people added later on the Team tab. The person making the change is never told. A notice that
 * can't be sent never fails the change itself.
 */
export function createProjectNotices({ notify, nameOf, projectName, logger }: ProjectNoticeDeps) {
  async function send(actorId: string, projectId: string, name: string, people: string[], ownerId: string | null): Promise<void> {
    if (people.length === 0) return;
    const actor = await nameOf(actorId);
    await Promise.all(
      people.map((userId) =>
        notify({
          userId,
          type: PROJECT_ADDED,
          title: userId === ownerId ? `${actor} made you the owner of ${name}` : `${actor} added you to the project ${name}`,
          body: null,
          entityType: 'project',
          entityId: projectId,
        }).catch((err) => logger?.error('project notice failed', { err, projectId, userId })),
      ),
    );
  }
  const others = (actorId: string, ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id && id !== actorId))];

  /** A new project: its owner first, then everyone put on its team. */
  async function projectCreated({ actorId, project, userIds }: { actorId: string; project: { id: string; name: string; ownerId: string | null }; userIds: string[] }): Promise<void> {
    try {
      await send(actorId, project.id, project.name, others(actorId, [project.ownerId, ...userIds]), project.ownerId);
    } catch (err) {
      logger?.error('project notices failed', { err, projectId: project.id });
    }
  }

  /** People newly added to a project's team (not those already on it). */
  async function membersAdded({ actorId, projectId, userIds }: { actorId: string; projectId: string; userIds: string[] }): Promise<void> {
    const people = others(actorId, userIds);
    if (people.length === 0) return;
    try {
      await send(actorId, projectId, await projectName(projectId), people, null);
    } catch (err) {
      logger?.error('project notices failed', { err, projectId });
    }
  }

  return { projectCreated, membersAdded };
}

export type ProjectNotices = ReturnType<typeof createProjectNotices>;
