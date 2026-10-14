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

/** A short quote of the message being answered (empty body once it was deleted). */
export interface ReplyQuote {
  id: string;
  userId: string;
  body: string;
  deleted: boolean;
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
  /** The message this one answers (older servers leave it out). */
  replyTo?: ReplyQuote | null;
  /** The sender's id for this message — how a pending send is matched to the server's copy. */
  clientId?: string | null;
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
  /** When their app last received this conversation (drives "delivered"). */
  lastDeliveredAt?: string | null;
}

/** The signed-in person's own settings for a conversation. */
export interface ConversationPrefs {
  favorite: boolean;
  archived: boolean;
  muted: boolean;
}

export interface ConversationSummary {
  conversation: ApiConversation;
  participants: ApiParticipant[];
  unread: number;
  lastMessage: (Omit<ApiMessage, 'reactions' | 'attachments'> & { reactions?: ReactionGroup[]; attachments?: ApiChatAttachment[] }) | null;
  /** Older servers leave it out: treat as all off. */
  prefs?: ConversationPrefs;
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
    /**
     * One page of history, oldest-first. Without `before` it's the newest page; pass the oldest
     * loaded message's `createdAt` as `before` to load the page just older than it.
     */
    messages: (conversationId: string, before?: string, limit?: number) => {
      const qs = new URLSearchParams();
      if (before) qs.set('before', before);
      if (limit) qs.set('limit', String(limit));
      const s = qs.toString();
      return client.get<{ data: ApiMessage[] }>(`/conversations/${conversationId}/messages${s ? `?${s}` : ''}`).then((r) => r.data);
    },
    /** Send. With a clientId a retry gets the first message back instead of a duplicate. */
    send: (conversationId: string, body: string, opts: { clientId?: string; replyToId?: string | null } = {}) =>
      client.post<{ data: ApiMessage }>(`/conversations/${conversationId}/messages`, { body, ...opts }).then((r) => r.data),
    /** Send a file (with an optional caption); `onProgress` hears how much has been sent (0–1). */
    uploadAttachment: (
      conversationId: string,
      file: File,
      body?: string,
      opts: { clientId?: string; replyToId?: string | null; onProgress?: (fraction: number) => void } = {},
    ) => {
      const form = new FormData();
      // Fields before the file, so the server reads them before the upload.
      if (opts.clientId) form.append('clientId', opts.clientId);
      if (opts.replyToId) form.append('replyToId', opts.replyToId);
      if (body) form.append('body', body);
      form.append('file', file);
      return client.upload<{ data: ApiMessage }>(`/conversations/${conversationId}/attachments`, form, opts.onProgress ? { onProgress: opts.onProgress } : undefined).then((r) => r.data);
    },
    /** Favorite / archive / mute — for the signed-in person only. */
    setPrefs: (conversationId: string, prefs: Partial<ConversationPrefs>) =>
      client.put<{ data: ConversationPrefs }>(`/conversations/${conversationId}/prefs`, prefs).then((r) => r.data),
    /** This app has received the conversation's messages (the sender sees "delivered"). */
    markDelivered: (conversationId: string) => client.post<void>(`/conversations/${conversationId}/delivered`, {}),
    /** User ids in the conversation. */
    members: (conversationId: string) => client.get<{ data: string[] }>(`/conversations/${conversationId}/members`).then((r) => r.data),
    /** Messages containing the words — in all of your conversations, or in one. */
    search: (q: string, conversationId?: string) => {
      const qs = new URLSearchParams({ q });
      if (conversationId) qs.set('conversationId', conversationId);
      return client.get<{ data: ApiMessage[] }>(`/chat/search?${qs.toString()}`).then((r) => r.data);
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
