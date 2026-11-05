import type { ApiClient } from '../lib/api-client';

export interface ApiComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  /** When its text was last changed (null if never). */
  editedAt?: string | null;
  createdAt: string;
  /** The comment this one replies to (null or absent for a top-level comment). */
  parentId?: string | null;
  /** 1.23: written by a client in the Client portal (the team sees it marked "Client"). */
  fromClient?: boolean;
  /** 1.23: a team reply to a client's comment that the client sees ("Visible to client"). */
  clientVisible?: boolean;
  /** 1.23: a client's comment names its writer (clients aren't in the people directory). */
  clientAuthor?: { name: string; organisation: string | null } | null;
}

/** A reply: the comment it answers, and (a client's comment only) whether the client sees it — and is emailed. */
export interface CommentReply {
  parentId: string;
  clientVisible?: boolean;
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
    /** A new comment, or a reply to one (`clientVisible` only on a reply to a client's comment: the server refuses it elsewhere). */
    add: (taskId: string, body: string, reply?: CommentReply) =>
      client
        .post<{ data: ApiComment }>(`/tasks/${taskId}/comments`, reply ? { body, parentId: reply.parentId, ...(reply.clientVisible ? { clientVisible: true } : {}) } : { body })
        .then((r) => r.data),
    /** Change the text of your own comment. */
    update: (commentId: string, body: string) => client.put<{ data: ApiComment }>(`/comments/${commentId}`, { body }).then((r) => r.data),
    /** Delete your own comment (an admin may delete anyone's). */
    remove: (commentId: string) => client.del<unknown>(`/comments/${commentId}`),
  };
}
