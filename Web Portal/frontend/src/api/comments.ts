import type { ApiClient } from '../lib/api-client';

export interface ApiComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  /** When its text was last changed (null if never). */
  editedAt?: string | null;
  createdAt: string;
}

/** Someone an @mention in a task's comments would notify. */
export interface ApiMentionable {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

export function commentsApi(client: ApiClient) {
  return {
    list: (taskId: string) => client.get<{ data: ApiComment[] }>(`/tasks/${taskId}/comments`).then((r) => r.data),
    /** The people who can be @mentioned in this task's comments (its project's members and admins). */
    mentionable: (taskId: string) => client.get<{ data: ApiMentionable[] }>(`/tasks/${taskId}/mentionable`).then((r) => r.data),
    add: (taskId: string, body: string) => client.post<{ data: ApiComment }>(`/tasks/${taskId}/comments`, { body }).then((r) => r.data),
    /** Change the text of your own comment. */
    update: (commentId: string, body: string) => client.put<{ data: ApiComment }>(`/comments/${commentId}`, { body }).then((r) => r.data),
    /** Delete your own comment (an admin may delete anyone's). */
    remove: (commentId: string) => client.del<unknown>(`/comments/${commentId}`),
  };
}
