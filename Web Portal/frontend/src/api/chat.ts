import type { ApiClient } from '../lib/api-client';

export type ConversationKind = 'PROJECT' | 'DIRECT';

export interface ApiConversation {
  id: string;
  kind: ConversationKind;
  projectId: string | null;
  createdAt: string;
}

export interface ReactionGroup {
  emoji: string;
  userIds: string[];
}

export interface ApiChatAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
  /** Server-relative path (e.g. /uploads/<key>); prefix with fileUrl() for a full URL. */
  url: string;
}

export interface ApiMessage {
  id: string;
  conversationId: string;
  userId: string;
  body: string;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: ReactionGroup[];
  attachments: ApiChatAttachment[];
}

/** Origin serving uploaded files (the API origin, without the /api/v1 prefix). */
const FILE_ORIGIN = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');
/** Absolute URL for an attachment's server-relative path. */
export const fileUrl = (path: string): string => `${FILE_ORIGIN}${path}`;

export interface ApiParticipant {
  conversationId: string;
  userId: string;
  lastReadAt: string | null;
  addedAt: string;
}

export interface ConversationSummary {
  conversation: ApiConversation;
  participants: ApiParticipant[];
  unread: number;
  lastMessage: (Omit<ApiMessage, 'reactions'> & { reactions?: ReactionGroup[] }) | null;
}

export function chatApi(client: ApiClient) {
  return {
    /** The signed-in user's inbox (project channels they've opened + DMs), with unread counts. */
    conversations: () => client.get<{ data: ConversationSummary[] }>('/conversations').then((r) => r.data),
    /** Get-or-create a project's channel and its recent messages. */
    openProjectChannel: (projectId: string) =>
      client.get<{ data: { conversation: ApiConversation; messages: ApiMessage[] } }>(`/projects/${projectId}/chat`).then((r) => r.data),
    /** Get-or-create a 1:1 conversation with another user. */
    startDirect: (userId: string) =>
      client.post<{ data: ApiConversation }>('/conversations/direct', { userId }).then((r) => r.data),
    messages: (conversationId: string, before?: string) =>
      client
        .get<{ data: ApiMessage[] }>(`/conversations/${conversationId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`)
        .then((r) => r.data),
    send: (conversationId: string, body: string) =>
      client.post<{ data: ApiMessage }>(`/conversations/${conversationId}/messages`, { body }).then((r) => r.data),
    uploadAttachment: (conversationId: string, file: File, body?: string) => {
      const form = new FormData();
      if (body) form.append('body', body);
      form.append('file', file);
      return client.upload<{ data: ApiMessage }>(`/conversations/${conversationId}/attachments`, form).then((r) => r.data);
    },
    edit: (messageId: string, body: string) =>
      client.patch<{ data: ApiMessage }>(`/messages/${messageId}`, { body }).then((r) => r.data),
    remove: (messageId: string) => client.del<void>(`/messages/${messageId}`),
    addReaction: (messageId: string, emoji: string) =>
      client.post<{ data: unknown }>(`/messages/${messageId}/reactions`, { emoji }).then((r) => r.data),
    removeReaction: (messageId: string, emoji: string) =>
      client.del<void>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
    markRead: (conversationId: string) => client.post<void>(`/conversations/${conversationId}/read`, {}),
  };
}
