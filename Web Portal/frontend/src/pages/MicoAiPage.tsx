import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { micoAiApi, micoAiChatKey, MICO_AI_CHATS_KEY, type ConfirmBody, type MicoAiChat, type MicoAiMessage } from '../api/mico-ai';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { ApiError } from '../lib/api-client';
import { downloadBlob, fileNameOf } from '../lib/download';
import { useFrameOffset } from '../lib/useFrameOffset';
import { useDateSettings } from '../lib/useDatePrefs';
import { chatTitle, copyTextOf, suggestedQuestions } from '../lib/mico-ai';
import { useAuthStore } from '../stores/auth-store';
import { useDialog } from '../hooks/useDialog';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ModalPortal } from '../components/ui/ModalPortal';
import { ChatList } from '../components/mico-ai/ChatList';
import { MessageView } from '../components/mico-ai/MessageView';
import type { ProposalActions } from '../components/mico-ai/ProposalCard';
import { MicoAiMark } from '../components/mico-ai/AnswerParts';
import { Composer, type ComposerHandle } from '../components/mico-ai/Composer';
import { AlertIcon, ArrowDownIcon, CloseIcon, EditIcon, PlusIcon } from '../components/chat/icons';
import { useMediaQuery } from '../components/calendar/calendar-ui';

const api = micoAiApi(apiClient);
const SCOPE = ['Tasks', 'Meetings', 'Reports', 'Chat'];
const MAX_QUESTION = 4000;
/** Within this many px of the end, the conversation counts as "at the newest message". */
const NEAR_END = 48;
/** Scrolled up further than this (px), "Jump to latest" appears. */
const JUMP_AFTER = 240;
/** What a screen reader hears once when MICO AI starts on a question. */
const WORKING = 'MICO AI is working on your question…';
/** What a confirmed (or undone) card can change: these lists are read again, so open views show it. */
const CHANGED_BY_CARDS = new Set(['tasks', 'task', 'board', 'project-tasks', 'my-tasks', 'calendar', 'task-activity', 'assignees', 'workload', 'project', 'meetings', 'meeting', 'my-action-items']);

/** Our sentence for a request that failed: the server's own words for a refusal, else a plain cause. */
function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  if (err instanceof TypeError) return 'Couldn’t reach the server. Check your connection and try again.';
  return 'Something went wrong. Try again.';
}

/** The words a screen reader hears when an answer arrives. */
function announcement(m: MicoAiMessage): string {
  if (m.status === 'stopped') return 'MICO AI stopped.';
  if (m.status === 'error') return `MICO AI couldn’t answer: ${m.error ?? ''}`;
  if (m.answer?.kind === 'proposal') return `MICO AI suggests changes: ${m.text.slice(0, 300)} Nothing changes until you confirm them.`;
  return `MICO AI answered: ${copyTextOf(m).slice(0, 400)}`;
}

/** Small line icons for the suggested questions (drawn, never emoji). */
const SUGGESTION_ICONS = [
  <path key="t" d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM8 12l2.5 2.5L16 9" />,
  <path key="c" d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8.5 3v4M15.5 3v4" />,
  <path key="w" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  <path key="p" d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />,
];

/** The list of chats on a phone or tablet: a sheet from ☰ (Escape and Close dismiss it; focus returns to ☰). */
function ChatsDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  return (
    // At the end of <body> (the page's animated wrapper would keep a fixed layer under the top bar),
    // ending where a phone's on-screen keyboard begins, so Search chats stays in view while typing.
    <ModalPortal>
      <div className="above-keyboard fixed inset-x-0 z-50 lg:hidden">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-label="Chats" tabIndex={-1} className="absolute inset-y-0 start-0 flex w-80 max-w-[88vw] flex-col bg-ground shadow-lift outline-none animate-slide-in-right">
          <button type="button" onClick={onClose} aria-label="Close chats" className="absolute end-2 top-3 z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface hover:text-ink">
            <CloseIcon size={18} />
          </button>
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}

/** The chat's name in the header, renamed in place (Enter saves, Escape cancels). */
function ChatTitle({ chat, onRename }: { chat: MicoAiChat | null; onRename: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const title = chat ? chatTitle(chat) : 'New chat';
  if (editing && chat) {
    const save = (v: string) => {
      setEditing(false);
      const clean = v.replace(/\s+/g, ' ').trim();
      if (clean && clean !== chat.title) onRename(clean);
    };
    return (
      <input
        autoFocus
        aria-label="Chat name"
        defaultValue={chat.title}
        maxLength={200}
        dir="auto"
        onKeyDown={(e) => {
          if (e.key === 'Enter') save(e.currentTarget.value);
          else if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        onBlur={(e) => save(e.currentTarget.value)}
        className="min-w-0 flex-1 rounded-lg border border-brand bg-surface px-2.5 py-1 font-display text-[0.9375rem] font-semibold text-ink outline-none ring-2 ring-brand/20"
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <h2 dir="auto" className="truncate font-display text-[0.9375rem] font-semibold text-ink">{title}</h2>
      {chat ? (
        <button type="button" aria-label="Rename this chat" onClick={() => setEditing(true)} className="grid h-8 w-8 flex-none place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink">
          <EditIcon size={15} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * MICO AI: a chat assistant that answers from the MICO360 data the person can see, laid out like
 * ChatGPT. The page fills the window under the top bar: the chats in a slim rail on the left (a sheet
 * from ☰ on a phone or tablet), and the conversation in a column of comfortable reading width,
 * centred in a message area that scrolls across the full width, with the box pinned at the bottom.
 * Asking returns a pending answer at once; the page follows it (dots and what MICO AI is doing, with
 * Stop) until it is written.
 */
export function MicoAiPage({ pollMs = 1000, searchDebounceMs = 250 }: { pollMs?: number; searchDebounceMs?: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  // The open chat, kept here as well as in the address (?chat=): React Router changes the address
  // in a transition, and until it lands the page must not still act on the chat it is leaving (a
  // quick question after New chat would be ignored, or asked in the old chat).
  const urlChat = params.get('chat');
  const [chatId, setChatId] = useState<string | null>(urlChat);
  useEffect(() => setChatId(urlChat), [urlChat]);
  const goTo = useCallback(
    (id: string | null) => {
      setChatId(id);
      setParams(id ? { chat: id } : {});
    },
    [setParams],
  );
  const myId = useAuthStore((s) => s.user?.id);
  const isAdmin = useAuthStore((s) => (s.user?.roles ?? []).includes('ADMIN'));
  const { timeZone } = useDateSettings();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [deleting, setDeleting] = useState<MicoAiChat | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [live, setLive] = useState('');
  /** A chat deleted while it was open (its answer can't be followed any more). */
  const [gone, setGone] = useState<string | null>(null);
  /** Older messages loaded with "Load earlier messages", for the open chat. */
  const [earlier, setEarlier] = useState<{ chatId: string; messages: MicoAiMessage[]; hasMore: boolean } | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  /** Scrolled well up from the newest message: offer "Jump to latest". */
  const [jump, setJump] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** The newest message is in view (so it stays in view when the area gets shorter). */
  const atEnd = useRef(true);
  const frameRef = useRef<HTMLDivElement>(null);
  const frameOffset = useFrameOffset(frameRef);
  const wide = useMediaQuery('(min-width: 40em)');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), searchDebounceMs);
    return () => clearTimeout(t);
  }, [query, searchDebounceMs]);

  const statusQ = useQuery({ queryKey: ['mico-ai', 'status'], queryFn: () => api.status(), staleTime: 60_000 });
  const listQ = useQuery({ queryKey: [...MICO_AI_CHATS_KEY, debounced.trim()], queryFn: () => api.list(debounced) });
  const chatQ = useQuery({ queryKey: micoAiChatKey(chatId ?? ''), queryFn: () => api.get(chatId!), enabled: !!chatId, staleTime: 10_000 });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });

  const ready = statusQ.data?.ready ?? true;
  const chats = Array.isArray(listQ.data) ? listQ.data : [];
  const latest = chatQ.data?.messages ?? [];
  const older = earlier && earlier.chatId === chatId ? earlier : null;
  const messages = older ? [...older.messages.filter((o) => !latest.some((x) => x.id === o.id)), ...latest] : latest;
  const hasMore = older ? older.hasMore : !!chatQ.data?.hasMore;
  const isGone = !!chatId && gone === chatId;
  // The list is reloaded after every question, so its entry has the name the first question gave the chat.
  const chat = chats.find((c) => c.id === chatId) ?? chatQ.data?.chat ?? null;
  const pending = messages.find((m) => m.role === 'assistant' && m.status === 'pending') ?? null;
  const firstName = (Array.isArray(dirQ.data) ? dirQ.data : []).find((u) => u.id === myId)?.firstName?.trim();
  const projectName = useMemo(() => {
    const list = Array.isArray(projectsQ.data) ? projectsQ.data : [];
    return list.find((p) => p.status === 'ACTIVE')?.name ?? list[0]?.name ?? null;
  }, [projectsQ.data]);

  const refreshList = useCallback(() => void qc.invalidateQueries({ queryKey: MICO_AI_CHATS_KEY }), [qc]);
  const patchMessage = useCallback(
    (id: string, m: MicoAiMessage) => {
      qc.setQueryData<{ chat: MicoAiChat; messages: MicoAiMessage[] }>(micoAiChatKey(id), (old) => (old ? { ...old, messages: old.messages.map((x) => (x.id === m.id ? m : x)) } : old));
    },
    [qc],
  );

  /** A message as the server now has it: in the chat, and among older messages loaded above it. */
  const applyMessage = useCallback(
    (id: string, m: MicoAiMessage) => {
      patchMessage(id, m);
      setEarlier((e) => (e && e.chatId === id && e.messages.some((x) => x.id === m.id) ? { ...e, messages: e.messages.map((x) => (x.id === m.id ? m : x)) } : e));
    },
    [patchMessage],
  );

  /**
   * Confirm, cancel or undo a card of proposed changes. The server's answer replaces the message (a
   * repeat returns the same one); the task and meeting lists that may be open are read again. A
   * refusal comes back as words for the card, and the card is read again (its state may have moved on).
   */
  const cardActions = useCallback(
    (messageId: string): ProposalActions => {
      const refresh = () => {
        if (!chatId) return;
        void api.message(chatId, messageId).then((m) => applyMessage(chatId, m), () => {});
      };
      const act = async (call: (id: string) => Promise<MicoAiMessage>): Promise<string | null> => {
        if (!chatId) return 'This chat isn’t open any more.';
        try {
          applyMessage(chatId, await call(chatId));
          void qc.invalidateQueries({ predicate: (q) => CHANGED_BY_CARDS.has(String(q.queryKey[0])) });
          return null;
        } catch (err) {
          refresh();
          return errorText(err);
        }
      };
      return {
        confirm: (body: ConfirmBody) => act((id) => api.confirm(id, messageId, body)),
        cancel: () => act((id) => api.cancel(id, messageId)),
        undo: () => act((id) => api.undo(id, messageId)),
        announce: setLive,
        refresh,
      };
    },
    [chatId, applyMessage, qc],
  );

  // Follow a pending answer until it is written (or stopped, or fails).
  const pollQ = useQuery({
    queryKey: ['mico-ai', 'message', chatId, pending?.id],
    queryFn: () => api.message(chatId!, pending!.id),
    enabled: !!chatId && !!pending && !isGone,
    refetchInterval: pollMs,
    gcTime: 0,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  // The chat was deleted somewhere else (another tab): stop following its answer and say so.
  useEffect(() => {
    const err = pollQ.error;
    if (chatId && err instanceof ApiError && err.status === 404) {
      setGone(chatId);
      refreshList();
    }
  }, [pollQ.error, chatId, refreshList]);
  useEffect(() => {
    const m = pollQ.data;
    if (!m || !chatId || m.id !== pending?.id) return;
    if (m.status !== pending.status || m.step !== pending.step) patchMessage(chatId, m);
    if (m.status !== 'pending') {
      setLive(announcement(m));
      refreshList();
    }
  }, [pollQ.data, chatId, pending, patchMessage, refreshList]);

  const followed = useRef<string | null>(null);
  useEffect(() => {
    const was = followed.current;
    followed.current = pending?.id ?? null;
    if (!was || pending) return;
    const active = document.activeElement;
    // (Without scrolling: where the conversation scrolls to is decided below.)
    if (!active || active === document.body) document.getElementById(`mico-ai-message-${was}`)?.focus({ preventScroll: true });
  }, [pending]);

  // A screen reader hears once that MICO AI is working on a question (not every step); the answer, a
  // stop or a failure is announced when it comes.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || announced.current === pending.id) return;
    announced.current = pending.id;
    setLive(WORKING);
  }, [pending]);

  // Where the conversation scrolls (the list is scrolled directly: scrollIntoView moves the Tab start in
  // Chrome). What changed since the last look decides it:
  // - another chat: its newest message (a new chat opens at its top: the greeting and any notice first);
  // - older messages came in above ("Load earlier messages"): you stay where you were;
  // - a new message at the end (you asked): the end;
  // - an answer finished while you followed it: its start, when it is taller than the view, else the end;
  // - a new progress step: the end, only if you are already there.
  // (Nothing seen yet: the first look always places the conversation, a new chat at its top.)
  const seen = useRef<{ chatId: string | null | undefined; first: string | null; last: string | null; pendingId: string | null; step: string | null }>({ chatId: undefined, first: null, last: null, pendingId: null, step: null });
  /** The message area's height and position just before older messages are put in above. */
  const keepPlace = useRef<{ height: number; top: number } | null>(null);
  const firstId = messages[0]?.id ?? null;
  const lastId = messages[messages.length - 1]?.id ?? null;
  useLayoutEffect(() => {
    const el = scroller.current;
    const was = seen.current;
    seen.current = { chatId, first: firstId, last: lastId, pendingId: pending?.id ?? null, step: pending?.step ?? null };
    if (!el) return;
    const toEnd = () => {
      el.scrollTop = el.scrollHeight;
      atEnd.current = true;
      setJump(false);
    };
    const toTop = () => {
      el.scrollTop = 0;
      atEnd.current = false;
      setJump(false);
    };
    if (chatId !== was.chatId) {
      keepPlace.current = null;
      if (messages.length) toEnd();
      else toTop();
      return;
    }
    if (keepPlace.current && firstId !== was.first) {
      el.scrollTop = keepPlace.current.top + (el.scrollHeight - keepPlace.current.height);
      keepPlace.current = null;
      return;
    }
    if (lastId !== was.last) {
      if (messages.length) toEnd();
      else toTop();
      return;
    }
    if (was.pendingId && was.pendingId !== (pending?.id ?? null)) {
      if (!atEnd.current) return;
      const answer = document.getElementById(`mico-ai-message-${was.pendingId}`);
      const r = answer?.getBoundingClientRect();
      if (r && r.height > el.clientHeight) {
        el.scrollTop = Math.max(0, el.scrollTop + r.top - el.getBoundingClientRect().top - 16);
        atEnd.current = false;
      } else toEnd();
      return;
    }
    if ((pending?.step ?? null) !== was.step && atEnd.current) toEnd();
  }, [chatId, firstId, lastId, pending?.id, pending?.step, messages.length]);

  // When the message area gets shorter (a phone's keyboard opens, the window is resized) while the
  // newest message is in view, it stays in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const fromEnd = el.scrollHeight - el.scrollTop - el.clientHeight;
    atEnd.current = fromEnd <= NEAR_END;
    setJump(fromEnd > JUMP_AFTER);
  };

  /** Back to the newest message. From the keyboard, focus moves on to the box (the button goes away); a click or tap leaves focus alone, so a phone doesn't open its keyboard. */
  const jumpToLatest = (fromKeyboard: boolean) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atEnd.current = true;
    setJump(false);
    if (fromKeyboard) composer.current?.focus();
  };

  const openChat = (id: string | null) => {
    setDrawer(false);
    setError(null);
    goTo(id);
  };

  const send = useCallback(
    async (raw: string, opts: { newChat?: boolean; retryOf?: string } = {}) => {
      const text = raw.trim().slice(0, MAX_QUESTION);
      if (!text || sending) return;
      setSending(true);
      setError(null);
      // A chat deleted elsewhere can't take a question: a new one starts.
      let id = opts.newChat || (chatId && gone === chatId) ? null : chatId;
      let created = false;
      try {
        if (!id) {
          const c = await api.create();
          id = c.id;
          created = true;
          qc.setQueryData(micoAiChatKey(id), { chat: c, messages: [] });
          goTo(id);
        }
        // Retry names the answer it asks again, so the server replaces that answer's unconfirmed card.
        const r = await api.ask(id, text, !created && opts.retryOf ? { retryOf: opts.retryOf } : {});
        await qc.cancelQueries({ queryKey: micoAiChatKey(id) });
        qc.setQueryData<{ chat: MicoAiChat; messages: MicoAiMessage[] }>(micoAiChatKey(id), (old) => ({
          chat: old?.chat ?? (chats.find((c) => c.id === id) as MicoAiChat),
          messages: [...(old?.messages ?? []).filter((m) => m.id !== r.question.id && m.id !== r.answer.id), r.question, r.answer],
        }));
        refreshList();
        void qc.invalidateQueries({ queryKey: micoAiChatKey(id) });
      } catch (err) {
        setError(errorText(err));
        composer.current?.restore(text); // the question goes back in the box
        // A chat made just for this question stays only if the question was asked.
        if (created && id) {
          await api.remove(id).catch(() => {});
          qc.removeQueries({ queryKey: micoAiChatKey(id) });
          goTo(null);
        }
        refreshList();
      } finally {
        setSending(false);
        composer.current?.focus();
      }
    },
    [chatId, sending, qc, goTo, refreshList, chats, gone],
  );

  // "Ask MICO AI" from Ctrl+K arrives as the page's state: a new chat with that question, asked once.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const ask = (location.state as { ask?: unknown } | null)?.ask;
    if (asked.current === location.key || typeof ask !== 'string' || !ask.trim()) return;
    asked.current = location.key;
    navigate({ pathname: location.pathname, search: '' }, { replace: true, state: null });
    void send(ask, { newChat: true });
  }, [location.state, location.key, location.pathname, navigate, send]);

  const stop = async () => {
    if (!chatId || !pending) return;
    try {
      const m = await api.stop(chatId, pending.id);
      patchMessage(chatId, m);
      setLive(announcement(m));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const rename = async (id: string, title: string) => {
    try {
      const c = await api.rename(id, title);
      qc.setQueryData<{ chat: MicoAiChat; messages: MicoAiMessage[] }>(micoAiChatKey(id), (old) => (old ? { ...old, chat: c } : old));
      refreshList();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.remove(deleting.id);
      qc.removeQueries({ queryKey: micoAiChatKey(deleting.id) });
      if (deleting.id === chatId) goTo(null);
      setDeleting(null);
      refreshList();
    } catch (err) {
      setDeleteError(errorText(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const loadEarlier = async () => {
    const first = messages[0];
    if (!chatId || !first) return;
    setLoadingEarlier(true);
    try {
      const page = await api.older(chatId, first.id);
      const el = scroller.current;
      if (el) keepPlace.current = { height: el.scrollHeight, top: el.scrollTop };
      setEarlier({ chatId, messages: [...page.messages, ...(older?.messages ?? [])], hasMore: page.hasMore });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingEarlier(false);
    }
  };

  const download = async (messageId: string, n: number, format: 'xlsx' | 'pdf') => {
    if (!chatId) return;
    try {
      const blob = await api.download(chatId, messageId, n, format);
      downloadBlob(fileNameOf(blob) ?? `mico-ai-table-${n}.${format}`, blob);
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** The whole answer (its words, every table, its sources) as one PDF report. */
  const report = async (messageId: string) => {
    if (!chatId) return;
    try {
      const blob = await api.report(chatId, messageId);
      downloadBlob(fileNameOf(blob) ?? 'mico-ai-answer.pdf', blob);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const canAsk = ready && !pending && !sending;
  const questionBefore = (i: number) => [...messages.slice(0, i)].reverse().find((m) => m.role === 'user')?.text ?? '';
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const welcome = !chatId || (chatQ.isSuccess && messages.length === 0);

  const list = (
    <ChatList
      chats={chats}
      activeId={chatId}
      query={query}
      onQuery={setQuery}
      onOpen={(id) => openChat(id)}
      onNew={() => {
        openChat(null);
        setTimeout(() => composer.current?.focus(), 0);
      }}
      onRename={(id, title) => void rename(id, title)}
      onDelete={(c) => {
        setDeleteError(null);
        setDeleting(c);
      }}
      timeZone={timeZone}
      loading={listQ.isLoading}
      error={listQ.isError ? () => void listQ.refetch() : null}
    />
  );

  const headerButton = 'grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink lg:hidden';

  return (
    // Edge to edge: the page's own gutters and padding are taken back, so the chat fills the window
    // under the top bar (no boxed frame).
    <div className="-my-4 mx-[-2.6316%] lg:-my-5">
      <h1 className="sr-only">MICO AI</h1>
      <div
        ref={frameRef}
        style={frameOffset !== null ? ({ '--chat-top': `${frameOffset}px` } as React.CSSProperties) : undefined}
        className="chat-frame chat-frame-keyboard grid overflow-hidden bg-surface [--chat-top:57px] lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]"
      >
        <aside className="hidden min-h-0 border-e border-line bg-ground/60 lg:flex lg:flex-col">{list}</aside>

        <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-col">
          <header className="flex min-h-11 flex-none items-center gap-1.5 border-b border-line/70 px-2 sm:min-h-[3.25rem] sm:px-5 lg:px-6">
            <button type="button" aria-label="Open chats" onClick={() => setDrawer(true)} className={headerButton}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                <path d="M9.5 4.5v15" />
              </svg>
            </button>
            <ChatTitle key={chat?.id ?? 'new'} chat={chatId ? chat : null} onRename={(t) => chatId && void rename(chatId, t)} />
            <button type="button" aria-label="New chat" onClick={() => openChat(null)} className={headerButton}>
              <PlusIcon size={18} />
            </button>
          </header>

          {/* Focusable, so the messages can be scrolled from the keyboard even when nothing in them is a control. */}
          <div
            ref={scroller}
            tabIndex={0}
            role="region"
            aria-label="Messages"
            onScroll={onScroll}
            // A size container: an answer's wide table may use its width (see AnswerTable).
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain outline-none [container-type:inline-size] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50"
          >
            <div data-mico-column="" className={`mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:gap-7 sm:px-6 sm:py-8 ${welcome ? 'min-h-full justify-center' : ''}`}>
              {!ready ? (
                <div className="flex gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink">
                  <span className="mt-0.5 flex-none text-warning">
                    <AlertIcon size={18} />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p>{statusQ.data?.message ?? 'MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.'}</p>
                    {isAdmin ? (
                      <Link to="/admin/ai" className="tap font-semibold text-brand underline-offset-2 hover:underline">
                        Open AI Management
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {isGone ? (
                <p role="alert" className="rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink">This chat was deleted.</p>
              ) : null}
              {hasMore ? (
                <button type="button" onClick={() => void loadEarlier()} disabled={loadingEarlier} className="mx-auto rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-ground disabled:opacity-60">
                  {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
                </button>
              ) : null}
              {chatId && chatQ.isError ? (
                <p className="rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">{errorText(chatQ.error)}</p>
              ) : null}
              {welcome ? (
                <div className="flex flex-col gap-7 sm:gap-8">
                  <div className="flex flex-col items-center text-center">
                    <MicoAiMark size="lg" />
                    <h3 className="mt-4 font-display text-2xl font-semibold text-ink sm:text-[1.75rem]">{firstName ? `How can I help, ${firstName}?` : 'How can I help?'}</h3>
                    <p className="mt-1.5 max-w-md text-sm text-ink-2">I answer from your tasks, projects, meetings, reports and team chat.</p>
                    <ul aria-label="MICO AI reads" className="mt-3 flex flex-wrap justify-center gap-1.5">
                      {SCOPE.map((s) => (
                        <li key={s} className="rounded-full border border-line bg-ground/60 px-2.5 py-0.5 text-xs font-medium text-ink-2">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <ul aria-label="Suggested questions" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                    {suggestedQuestions(projectName).map((q, i) => (
                      <li key={q} className="min-w-0">
                        <button
                          type="button"
                          disabled={!canAsk}
                          onClick={() => void send(q)}
                          className="group flex h-full w-full items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 text-start text-sm text-ink shadow-soft transition-colors hover:border-brand/30 hover:bg-ground/50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-brand/5 text-brand transition-colors group-hover:bg-brand/10">
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              {SUGGESTION_ICONS[i % SUGGESTION_ICONS.length]}
                            </svg>
                          </span>
                          <span className="min-w-0 pt-1.5 leading-snug [overflow-wrap:anywhere]">{q}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {chatId && chatQ.isLoading ? <p className="text-sm text-ink-3">Loading…</p> : null}
              {messages.map((m, i) => (
                <MessageView
                  key={m.id}
                  message={m}
                  latest={m === lastAssistant}
                  actions={{
                    ask: (t) => void send(t),
                    retry: () => void send(questionBefore(i), { retryOf: m.id }),
                    download: (n, f) => void download(m.id, n, f),
                    report: () => void report(m.id),
                    canAsk,
                    ...(m.answer?.kind === 'proposal' ? { proposal: cardActions(m.id) } : {}),
                  }}
                />
              ))}
            </div>
          </div>

          {/* The box, pinned under the messages (a soft fade over what scrolls beneath it), as wide as the reading column. */}
          <div className="relative flex-none bg-surface pb-2.5 pt-1 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-gradient-to-t before:from-surface before:to-transparent before:content-[''] sm:pb-4">
            {jump ? (
              <button
                type="button"
                aria-label="Jump to latest"
                onClick={(e) => jumpToLatest(e.detail === 0)}
                className="absolute bottom-full left-1/2 z-10 mb-3 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-card transition-colors hover:text-ink"
              >
                <ArrowDownIcon size={17} />
              </button>
            ) : null}
            <Composer
              ref={composer}
              ready={ready}
              canAsk={canAsk}
              pending={!!pending}
              sending={sending}
              wide={wide}
              error={error}
              maxLength={MAX_QUESTION}
              onSend={(text) => void send(text)}
              onStop={() => void stop()}
            />
          </div>
        </section>
      </div>

      <div role="status" aria-live="polite" className="sr-only">{live}</div>

      {drawer ? <ChatsDrawer onClose={() => setDrawer(false)}>{list}</ChatsDrawer> : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete this chat?"
          confirmLabel="Delete chat"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleting(null)}
        >
          “{chatTitle(deleting)}” and its messages will be deleted for good. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
