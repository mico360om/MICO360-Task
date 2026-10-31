import { useCallback, useEffect, useMemo, useState } from 'react';
import { skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { useDebouncedValue } from './useDebounced';
import { sessionChangedError, type CallOpts } from '../lib/api-client';
import type { ChatView, ConfirmBody, MicoAiMessage } from '../lib/mico-ai-api';
import {
  CARD_POLL_MS,
  CHANGED_BY_CARDS,
  MAX_QUESTION,
  MICO_AI_ACTION_TIMEOUT_MS,
  MICO_AI_POLL_MS,
  afterAskFailed,
  createActionGate,
  earlierWithMessage,
  errorText,
  goneCopy,
  isGoneError,
  micoAiChatKey,
  micoAiChatsKey,
  micoAiChatsRoot,
  micoAiEarlierKey,
  micoAiMessageKey,
  micoAiStatusKey,
  pollRetry,
  withMessage,
  type EarlierPage,
} from '../lib/mico-ai-chat';

/**
 * MICO AI's hooks (Stage 3 Task 12). Every key carries the person's id and every request goes as
 * that person (`asUser`), so after a sign-out and someone else's sign-in nothing of the first
 * person's chats can show or be asked for; nothing is kept in the offline copy (sign-out's cache
 * clear drops it all). A pending answer is polled like the website — every second, never while
 * the app is in the background, read once on coming back — and a card's Confirm, Cancel and Undo
 * go one at a time; one whose answer was lost is read back, never sent again.
 */

/** A request is always someone's: none goes while nobody is signed in (it would go with whoever is next). */
function mustBeSignedIn(userId: string | null): asserts userId is string {
  if (!userId) throw sessionChangedError();
}

/** A message as the server now has it: in the chat, and among the older messages loaded above it. */
function putMessage(qc: QueryClient, userId: string, chatId: string, m: MicoAiMessage): void {
  qc.setQueryData<ChatView>(micoAiChatKey(userId, chatId), (v) => withMessage(v, m));
  qc.setQueryData<EarlierPage>(micoAiEarlierKey(userId, chatId), (p) => earlierWithMessage(p, m));
}

/** Is MICO AI set up (an AI service in AI Management)? */
export function useMicoAiStatus() {
  const { resources } = useServices();
  const userId = useUserId();
  return useQuery({
    queryKey: micoAiStatusKey(userId),
    queryFn: async ({ signal }) => {
      mustBeSignedIn(userId);
      return resources.micoAi.status({ asUser: userId, signal });
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/** The person's chats, newest first; `q` searches them once the typing has paused for 250 ms. */
export function useMicoAiChats(q: string) {
  const { resources } = useServices();
  const userId = useUserId();
  const settled = useDebouncedValue(q, 250).trim();
  return useQuery({
    queryKey: micoAiChatsKey(userId, settled),
    queryFn: async ({ signal }) => {
      mustBeSignedIn(userId);
      return resources.micoAi.chats(settled, { asUser: userId, signal });
    },
    enabled: !!userId,
  });
}

/** A chat with its latest messages. */
export function useMicoAiChat(chatId: string | null) {
  const { resources } = useServices();
  const userId = useUserId();
  return useQuery({
    queryKey: micoAiChatKey(userId, chatId ?? ''),
    queryFn: async ({ signal }) => {
      mustBeSignedIn(userId);
      return resources.micoAi.chat(chatId!, { asUser: userId, signal });
    },
    enabled: !!userId && !!chatId,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * The older messages loaded above a chat's latest ones ("Load earlier messages"): set only by
 * loadOlder (never fetched by itself), changed by a card's answer, and dropped when the chat
 * changes, as the website's `earlier` state.
 */
export function useEarlierMessages(chatId: string | null): EarlierPage | undefined {
  const userId = useUserId();
  const qc = useQueryClient();
  const q = useQuery<EarlierPage>({ queryKey: micoAiEarlierKey(userId, chatId ?? ''), queryFn: skipToken, staleTime: Infinity });
  useEffect(
    () => () => {
      if (chatId) qc.removeQueries({ queryKey: micoAiEarlierKey(userId, chatId), exact: true });
    },
    [qc, userId, chatId],
  );
  return chatId ? q.data : undefined;
}

/**
 * Follows the answer being written until it is done (or stopped, or fails): read every second while
 * the app is in front, not in the background, and once as soon as it is back. A change of status or
 * step is written into the chat; once it is no longer pending the chat list is read again (the
 * first question names the chat). A 404 means the chat was deleted elsewhere: `gone`.
 */
export function useAnswerPoll(chatId: string | null, pending: MicoAiMessage | null): { gone: boolean } {
  const { resources } = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const [goneChat, setGoneChat] = useState<string | null>(null);
  const isGone = !!chatId && goneChat === chatId;
  const q = useQuery({
    queryKey: micoAiMessageKey(userId, chatId ?? '', pending?.id ?? ''),
    queryFn: async ({ signal }) => {
      mustBeSignedIn(userId);
      return resources.micoAi.message(chatId!, pending!.id, { asUser: userId, signal });
    },
    enabled: !!userId && !!chatId && !!pending && !isGone,
    refetchInterval: MICO_AI_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
    retry: pollRetry,
  });
  useEffect(() => {
    if (chatId && userId && isGoneError(q.error)) {
      setGoneChat(chatId);
      // The answer it was writing stops on screen: no dots left turning for a chat that is gone.
      if (pending) putMessage(qc, userId, chatId, goneCopy(pending));
      void qc.invalidateQueries({ queryKey: micoAiChatsRoot(userId) });
    }
    // Only a new failure counts: pending is the answer that was followed when it came.
  }, [q.error, chatId, userId, qc]);
  const m = q.data;
  useEffect(() => {
    if (!m || !chatId || !userId || !pending || m.id !== pending.id) return;
    if (m.status !== pending.status || m.step !== pending.step) putMessage(qc, userId, chatId, m);
    if (m.status !== 'pending') void qc.invalidateQueries({ queryKey: micoAiChatsRoot(userId) });
  }, [m, chatId, userId, pending, qc]);
  return { gone: isGone };
}

/** A card being made or put back is read again every two seconds (the same background rule) until it settles. */
export function useCardRefresh(chatId: string, message: MicoAiMessage): void {
  const { resources } = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const status = message.answer?.proposal?.status;
  const moving = status === 'confirming' || status === 'undoing';
  const q = useQuery({
    queryKey: micoAiMessageKey(userId, chatId, message.id),
    queryFn: async ({ signal }) => {
      mustBeSignedIn(userId);
      return resources.micoAi.message(chatId, message.id, { asUser: userId, signal });
    },
    enabled: !!userId && moving,
    refetchInterval: CARD_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
    retry: pollRetry,
  });
  const m = q.data;
  useEffect(() => {
    if (m && userId && m.id === message.id) putMessage(qc, userId, chatId, m);
  }, [m, userId, chatId, message.id, qc]);
}

/** A question asked: the chat it went to — or why not, whether it goes back in the box, and the chat kept for it. */
export type AskResult = { chatId: string } | { error: string; restoreDraft: boolean; chatId: string | null };

/**
 * Ask, Stop, rename, delete, the downloads and older messages, for the open chat (null: none yet).
 * Each resolves null, or the words for what went wrong.
 */
export function useMicoAiActions(chatId: string | null) {
  const { resources, exporter } = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  return useMemo(() => {
    const refreshList = (u: string) => void qc.invalidateQueries({ queryKey: micoAiChatsRoot(u) });
    const notOpen = 'This chat isn’t open any more.';

    /**
     * Ask a question: in the open chat, or a new one (made first when there is none, or `newChat`).
     * Null when there is nothing to ask. A question whose answer was lost is read back (afterAskFailed).
     */
    async function ask(raw: string, o: { newChat?: boolean; retryOf?: string } = {}): Promise<AskResult | null> {
      const text = raw.trim().slice(0, MAX_QUESTION);
      if (!text) return null;
      if (!userId) return { error: errorText(sessionChangedError()), restoreDraft: true, chatId: null };
      let id = o.newChat ? null : chatId;
      let created = false;
      let asked = false;
      try {
        if (!id) {
          const c = await resources.micoAi.create({ asUser: userId });
          id = c.id;
          created = true;
          qc.setQueryData<ChatView>(micoAiChatKey(userId, id), { chat: c, messages: [] });
        }
        asked = true;
        // Retry names the answer it asks again, so the server replaces that answer's unconfirmed card.
        const r = await resources.micoAi.ask(id, text, !created && o.retryOf ? o.retryOf : undefined, { asUser: userId });
        const key = micoAiChatKey(userId, id);
        await qc.cancelQueries({ queryKey: key });
        qc.setQueryData<ChatView>(key, (old) => (old ? { ...old, messages: [...old.messages.filter((m) => m.id !== r.question.id && m.id !== r.answer.id), r.question, r.answer] } : old));
        refreshList(userId);
        void qc.invalidateQueries({ queryKey: key });
        return { chatId: id };
      } catch (err) {
        refreshList(userId);
        // Only the new chat failed to be made: the question never went, so it goes back in the box.
        if (!asked) return { error: errorText(err), restoreDraft: true, chatId: null };
        const after = afterAskFailed(err, created);
        if (after.reread && id) void qc.invalidateQueries({ queryKey: micoAiChatKey(userId, id) });
        if (after.deleteNewChat && id) {
          // A chat made just for this question stays only if the question was asked.
          await resources.micoAi.remove(id, { asUser: userId }).catch(() => {});
          qc.removeQueries({ queryKey: micoAiChatKey(userId, id) });
          id = null;
        }
        return { error: errorText(err), restoreDraft: after.restoreDraft, chatId: id };
      }
    }

    async function stop(m: MicoAiMessage): Promise<string | null> {
      if (!userId || !chatId) return notOpen;
      try {
        putMessage(qc, userId, chatId, await resources.micoAi.stop(chatId, m.id, { asUser: userId }));
        return null;
      } catch (err) {
        return errorText(err);
      }
    }

    async function rename(id: string, title: string): Promise<string | null> {
      if (!userId) return errorText(sessionChangedError());
      try {
        const c = await resources.micoAi.rename(id, title, { asUser: userId });
        qc.setQueryData<ChatView>(micoAiChatKey(userId, id), (old) => (old ? { ...old, chat: c } : old));
        refreshList(userId);
        return null;
      } catch (err) {
        return errorText(err);
      }
    }

    async function remove(id: string): Promise<string | null> {
      if (!userId) return errorText(sessionChangedError());
      try {
        await resources.micoAi.remove(id, { asUser: userId });
        qc.removeQueries({ queryKey: micoAiChatKey(userId, id) });
        qc.removeQueries({ queryKey: micoAiEarlierKey(userId, id) });
        refreshList(userId);
        return null;
      } catch (err) {
        return errorText(err);
      }
    }

    /** Table n (1 = the first) as Excel, through the share sheet. */
    async function downloadTable(m: MicoAiMessage, n: number, title: string): Promise<string | null> {
      if (!chatId) return notOpen;
      try {
        await exporter.exportFile(resources.micoAi.tablePath(chatId, m.id, n, 'xlsx'), `mico-ai-table-${n}.xlsx`, title);
        return null;
      } catch (err) {
        return errorText(err);
      }
    }

    /** The whole answer (its words, every table, its sources) as one PDF report. */
    async function downloadReport(m: MicoAiMessage): Promise<string | null> {
      if (!chatId) return notOpen;
      try {
        await exporter.exportFile(resources.micoAi.reportPath(chatId, m.id), 'mico-ai-answer.pdf', 'MICO AI answer');
        return null;
      } catch (err) {
        return errorText(err);
      }
    }

    /** The page of messages before `before`, put above those already shown (useEarlierMessages). */
    async function loadOlder(before: string): Promise<{ messages: MicoAiMessage[]; hasMore: boolean } | { error: string }> {
      if (!userId || !chatId) return { error: notOpen };
      try {
        const page = await resources.micoAi.older(chatId, before, { asUser: userId });
        qc.setQueryData<EarlierPage>(micoAiEarlierKey(userId, chatId), (old) => ({ messages: [...page.messages, ...(old?.messages ?? [])], hasMore: page.hasMore }));
        return page;
      } catch (err) {
        return { error: errorText(err) };
      }
    }

    return { ask, stop, rename, remove, downloadTable, downloadReport, loadOlder };
  }, [resources, exporter, userId, chatId, qc]);
}

/**
 * A card's Confirm, Cancel and Undo, one at a time (one gate per card). They make the changes before
 * answering, so they get two minutes. The answer replaces the card and the lists it can change are
 * read again; on any failure the card is read again — its answer may have been lost on the way —
 * and the action is never sent again by itself (a repeat would still apply it once on the server).
 */
export function useCardActions(chatId: string, messageId: string): { confirm(body: ConfirmBody): Promise<string | null>; cancel(): Promise<string | null>; undo(): Promise<string | null>; busy: boolean } {
  const { resources } = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const gate = useMemo(() => createActionGate(), [messageId]);
  const [busy, setBusy] = useState(false);
  const act = useCallback(
    async (call: (o: CallOpts) => Promise<MicoAiMessage>): Promise<string | null> => {
      if (!userId) return errorText(sessionChangedError());
      const out = await gate.run(async () => {
        setBusy(true);
        try {
          putMessage(qc, userId, chatId, await call({ asUser: userId, timeoutMs: MICO_AI_ACTION_TIMEOUT_MS }));
          void qc.invalidateQueries({ predicate: (q) => CHANGED_BY_CARDS.has(String(q.queryKey[0])) });
          return null;
        } catch (err) {
          void resources.micoAi.message(chatId, messageId, { asUser: userId }).then(
            (m) => putMessage(qc, userId, chatId, m),
            () => {},
          );
          return errorText(err);
        } finally {
          setBusy(false);
        }
      });
      // A tap while another action of the card runs does nothing (and says nothing).
      return out ?? null;
    },
    [gate, userId, qc, chatId, messageId, resources],
  );
  return {
    confirm: (body: ConfirmBody) => act((o) => resources.micoAi.confirm(chatId, messageId, body, o)),
    cancel: () => act((o) => resources.micoAi.cancel(chatId, messageId, o)),
    undo: () => act((o) => resources.micoAi.undo(chatId, messageId, o)),
    busy,
  };
}
