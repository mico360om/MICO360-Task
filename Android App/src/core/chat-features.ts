import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { useConversations, writeOrder } from './queries';
import { useOnline } from './chat';
import { isNetworkError } from '../lib/api-client';
import { CHAT_DELETE, CHAT_EDIT, CHAT_REACT } from '../lib/chat-actions';
import { needsDeliveryAck } from '../lib/chat-model';
import { applyReaction } from '../lib/chat-realtime';
import { threadKey } from '../lib/chat-cache';
import type { UploadEntry } from '../lib/chat-timeline';
import { directWith, fileProblem, prefsFailure, startDirectError, uploadFailure, withPrefs } from '../lib/chat-ui';
import { newIdempotencyKey } from '../lib/idempotency';
import { itemLanes, sendItemWrite } from '../lib/item-lanes';
import { presence } from '../lib/presence-store';
import { refresh } from '../lib/refresh';
import type { ApiChatMessage, ApiConversationSummary, ConversationPrefs, ReplyQuote } from '../lib/types';

/**
 * Chat features (3b), the website's: who is online, telling the server a message arrived, my
 * settings for a conversation, starting a direct conversation, a message's edit / deletion /
 * reactions (kept on this phone without a connection, in order per message), sending pictures and
 * files, and each conversation's unsent message.
 */

const INBOX = ['chat', 'conversations'];

/** Who is online right now (the server's presence events). */
export function usePresence(): ReadonlySet<string> {
  return useSyncExternalStore(presence.subscribe, presence.online, presence.online);
}

/**
 * Tell the server each new direct message from the other person reached this phone (once), so its
 * sender sees "Delivered" (the website's ChatSoundNotifier). Best effort: a failed report is tried
 * again the next time the list loads.
 */
export function useDeliveryAcks(): void {
  const { resources } = useServices();
  const myId = useUserId();
  const inbox = useConversations().data;
  const acked = useRef(new Set<string>());
  useEffect(() => {
    if (!myId || !Array.isArray(inbox)) return;
    for (const s of inbox) {
      if (!needsDeliveryAck(s, myId)) continue;
      const key = `${s.conversation.id}:${s.lastMessage!.id}`;
      if (acked.current.has(key)) continue;
      acked.current.add(key);
      resources.chat.markDelivered(s.conversation.id).catch(() => acked.current.delete(key));
    }
  }, [inbox, myId, resources]);
}

export interface PrefsTarget {
  conversationId: string | null;
  kind: 'PROJECT' | 'DIRECT';
  projectId?: string;
}

/**
 * Favorite, mute or archive a conversation — for me only. Shown at once in the list; a channel not
 * opened yet is opened first. Needs a connection (it says so).
 */
export function useConversationPrefs() {
  const { resources } = useServices();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const change = useCallback(
    async (target: PrefsTarget, patch: Partial<ConversationPrefs>): Promise<boolean> => {
      setError(null);
      try {
        const id = target.conversationId ?? (target.projectId ? (await resources.chat.openProjectChannel(target.projectId)).conversation.id : null);
        if (!id) return false;
        const where = { id, kind: target.kind, projectId: target.projectId };
        qc.setQueryData<ApiConversationSummary[]>(INBOX, (old) => withPrefs(old, where, patch));
        const saved = await resources.chat.setPrefs(id, patch);
        qc.setQueryData<ApiConversationSummary[]>(INBOX, (old) => withPrefs(old, where, saved));
        return true;
      } catch (e) {
        refresh(qc, [{ queryKey: INBOX }]);
        setError(prefsFailure(e));
        return false;
      }
    },
    [resources, qc],
  );
  return { change, error, clearError: () => setError(null) };
}

/**
 * Open the direct conversation with someone: the one that exists (from the list — offline too), or
 * a new one (needs a connection).
 */
export function useStartDirect(go: (conversationId: string, name: string) => void) {
  const { resources } = useServices();
  const myId = useUserId();
  const qc = useQueryClient();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(
    async (userId: string, name: string) => {
      if (opening) return;
      setError(null);
      const known = directWith(qc.getQueryData<ApiConversationSummary[]>(INBOX), myId ?? '', userId);
      if (known) return go(known, name);
      setOpening(userId);
      try {
        const conversation = await resources.chat.startDirect(userId);
        void qc.invalidateQueries({ queryKey: INBOX });
        go(conversation.id, name);
      } catch (e) {
        setError(startDirectError(e, name));
      } finally {
        setOpening(null);
      }
    },
    [opening, qc, myId, resources, go],
  );
  return { open, opening, error, clearError: () => setError(null) };
}

/**
 * A message's edit, deletion and reactions (3b). Each goes in its message's lane, in order with an
 * older change to it still on this phone; with no answer it is kept on the phone and sent later
 * (write-order) — the thread shows it meanwhile (chat-actions). A reaction shows at once.
 */
export function useChatMessageActions(conversationId: string) {
  const services = useServices();
  const { resources, chat } = services;
  const myId = useUserId() ?? '';
  const qc = useQueryClient();

  const edit = useCallback(
    async (messageId: string, body: string): Promise<void> => {
      const text = body.trim();
      const saved = await sendItemWrite(itemLanes, writeOrder(services), { kind: CHAT_EDIT, payload: { conversationId, messageId, body: text } }, () => resources.chat.edit(messageId, text));
      chat.patch(conversationId, messageId, (x) => ({ ...x, body: saved?.body ?? text, editedAt: saved?.editedAt ?? new Date().toISOString() }));
    },
    [services, resources, chat, conversationId],
  );

  const remove = useCallback(
    async (messageId: string): Promise<void> => {
      await sendItemWrite(itemLanes, writeOrder(services), { kind: CHAT_DELETE, payload: { conversationId, messageId } }, () => resources.chat.remove(messageId));
      chat.patch(conversationId, messageId, (x) => ({ ...x, body: '', deletedAt: x.deletedAt ?? new Date().toISOString(), attachments: [], reactions: [] }));
    },
    [services, resources, chat, conversationId],
  );

  /** Add my reaction, or take it back when it is there already. */
  const react = useCallback(
    async (m: Pick<ApiChatMessage, 'id' | 'reactions'>, emoji: string): Promise<void> => {
      const add = !(m.reactions ?? []).find((r) => r.emoji === emoji)?.userIds.includes(myId);
      chat.patch(conversationId, m.id, (x) => ({ ...x, reactions: applyReaction(x.reactions ?? [], emoji, myId, add) }));
      try {
        await sendItemWrite(itemLanes, writeOrder(services), { kind: CHAT_REACT, payload: { conversationId, messageId: m.id, emoji, add } }, () =>
          add ? resources.chat.addReaction(m.id, emoji) : resources.chat.removeReaction(m.id, emoji),
        );
      } catch (e) {
        // Refused: the thread is read again as the server has it. Kept (offline): it stays shown.
        if (!isNetworkError(e)) refresh(qc, [{ queryKey: threadKey(conversationId) }]);
        throw e;
      }
    },
    [services, resources, chat, conversationId, myId, qc],
  );

  return { edit, remove, react };
}

/** A file picked to send: what the picker gave. */
export interface PickedFile {
  uri: string;
  name: string;
  /** null when the picker doesn't know it (the server checks it). */
  size: number | null;
  type: string;
}

/**
 * Pictures and files sent into the conversation (3b), as on the website: each is checked first (10 MB,
 * the server's types), sent one after another with its progress, and shown in the thread meanwhile;
 * one that fails says why, with Retry (the same client id: never stored twice) and Discard. Files
 * need a connection: they aren't kept on the phone.
 */
export function useChatUploads(conversationId: string) {
  const { resources, chat } = useServices();
  const online = useOnline();
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const seq = useRef(0);

  const update = useCallback((key: string, patch: Partial<UploadEntry>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u))), []);

  const run = useCallback(
    (entry: UploadEntry) => {
      chain.current = chain.current.then(async () => {
        update(entry.key, { state: 'sending', error: undefined, progress: 0 });
        try {
          const saved = await resources.chat.uploadAttachment(
            conversationId,
            { uri: entry.uri, name: entry.name, type: entry.type },
            { body: entry.caption || undefined, clientId: entry.clientId, replyToId: entry.replyTo?.id, onProgress: (f) => update(entry.key, { progress: f }) },
          );
          // Its saved copy takes its place in the thread.
          if (saved?.id) chat.put(conversationId, saved);
          setUploads((list) => list.filter((u) => u.key !== entry.key));
        } catch (e) {
          update(entry.key, { state: 'failed', error: uploadFailure(e) });
        }
      });
      return chain.current;
    },
    [resources, chat, conversationId, update],
  );

  /** Send these files (the first with the caption); what couldn't be sent, and why. */
  const send = useCallback(
    (files: PickedFile[], caption: string, replyTo: ReplyQuote | null): { sent: number; problems: string[] } => {
      if (!online) return { sent: 0, problems: ['You’re offline — files can be sent when you’re connected.'] };
      const problems = files.map((f) => fileProblem(f)).filter((x): x is string => !!x);
      const ok = files.filter((f) => !fileProblem(f));
      const now = Date.now();
      const entries = ok.map<UploadEntry>((f, i) => ({
        key: `up-${++seq.current}`,
        clientId: newIdempotencyKey(),
        conversationId,
        name: f.name,
        size: f.size,
        type: f.type,
        uri: f.uri,
        progress: 0,
        state: 'sending',
        caption: i === 0 ? caption.trim() : '',
        replyTo: i === 0 ? replyTo : null,
        createdAt: new Date(now + i).toISOString(),
      }));
      setUploads((list) => [...list, ...entries]);
      for (const e of entries) void run(e);
      return { sent: entries.length, problems };
    },
    [online, conversationId, run],
  );

  const retry = useCallback(
    (key: string) => {
      const entry = uploads.find((u) => u.key === key);
      if (entry) void run(entry);
    },
    [uploads, run],
  );
  const discard = useCallback((key: string) => setUploads((list) => list.filter((u) => u.key !== key)), []);

  return { uploads, send, retry, discard };
}

/**
 * A conversation's unsent message, kept on this phone (3b): it comes back when the conversation is
 * opened again, and is kept as it is typed (after a short pause, and when the thread closes).
 */
export function useChatDraft(conversationId: string): [string, (text: string) => void] {
  const { drafts } = useServices();
  const [text, setTextState] = useState('');
  const latest = useRef('');
  const typed = useRef(false);

  useEffect(() => {
    let alive = true;
    typed.current = false;
    latest.current = '';
    setTextState('');
    if (!conversationId) return;
    void drafts.load(conversationId).then((saved) => {
      // What was typed meanwhile wins over the kept copy.
      if (!alive || typed.current || !saved) return;
      latest.current = saved;
      setTextState(saved);
    });
    return () => {
      alive = false;
      if (typed.current) void drafts.save(conversationId, latest.current);
    };
  }, [conversationId, drafts]);

  useEffect(() => {
    if (!conversationId || !typed.current) return;
    const t = setTimeout(() => void drafts.save(conversationId, text), 400);
    return () => clearTimeout(t);
  }, [text, conversationId, drafts]);

  const setText = useCallback((next: string) => {
    typed.current = true;
    latest.current = next;
    setTextState(next);
  }, []);
  return [text, setText];
}
