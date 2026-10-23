import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { micoAiApi, micoAiChatKey, MICO_AI_CHATS_KEY, type MicoAiChat, type MicoAiMessage } from '../api/mico-ai';
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
import { ChatList } from '../components/mico-ai/ChatList';
import { MessageView } from '../components/mico-ai/MessageView';
import { MicoAiMark } from '../components/mico-ai/AnswerParts';
import { CloseIcon, EditIcon, PlusIcon } from '../components/chat/icons';
import { useMediaQuery } from '../components/calendar/calendar-ui';

const api = micoAiApi(apiClient);
const SCOPE = ['Tasks', 'Meetings', 'Reports', 'Chat'];
const MAX_QUESTION = 4000;

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
  return `MICO AI answered: ${copyTextOf(m).slice(0, 400)}`;
}

/** The phone's list of chats: a dialog from ☰ (Escape and Close dismiss it; focus returns to ☰). */
function ChatsDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Chats" tabIndex={-1} className="absolute inset-y-0 start-0 flex w-80 max-w-[88vw] flex-col bg-surface shadow-lift outline-none animate-slide-in-right">
        <button type="button" onClick={onClose} aria-label="Close chats" className="absolute end-2 top-3 z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink">
          <CloseIcon size={18} />
        </button>
        {children}
      </div>
    </div>
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
        className="min-w-0 flex-1 rounded-lg border border-brand bg-surface px-2.5 py-1 font-display text-base font-semibold text-ink outline-none ring-2 ring-brand/20"
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <h2 dir="auto" className="truncate font-display text-base font-semibold text-ink">{title}</h2>
      {chat ? (
        <button type="button" aria-label="Rename this chat" onClick={() => setEditing(true)} className="grid h-8 w-8 flex-none place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink">
          <EditIcon size={15} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * MICO AI: a chat assistant that answers from the MICO360 data the person can see. Chats on the
 * left (a ☰ drawer on a phone), the conversation on the right. Asking returns a pending answer at
 * once; the page follows it (dots and what MICO AI is doing, with Stop) until it is written.
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
  const { timeZone } = useDateSettings();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [draft, setDraft] = useState('');
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
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const frameOffset = useFrameOffset(frameRef);
  const wide = useMediaQuery('(min-width: 40em)');

  // The box grows with what is typed (up to 200px) and shrinks back once it is sent.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    if (draft) el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

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
    if (!active || active === document.body) document.getElementById(`mico-ai-message-${was}`)?.focus();
  }, [pending]);

  // Keep the newest message in view (the list is scrolled directly: scrollIntoView moves the Tab start in Chrome).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending?.step, chatId]);

  const openChat = (id: string | null) => {
    setDrawer(false);
    setError(null);
    goTo(id);
  };

  const send = useCallback(
    async (raw: string, opts: { newChat?: boolean } = {}) => {
      const text = raw.trim().slice(0, MAX_QUESTION);
      if (!text || sending) return;
      setSending(true);
      setError(null);
      setDraft('');
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
        const r = await api.ask(id, text);
        await qc.cancelQueries({ queryKey: micoAiChatKey(id) });
        qc.setQueryData<{ chat: MicoAiChat; messages: MicoAiMessage[] }>(micoAiChatKey(id), (old) => ({
          chat: old?.chat ?? (chats.find((c) => c.id === id) as MicoAiChat),
          messages: [...(old?.messages ?? []).filter((m) => m.id !== r.question.id && m.id !== r.answer.id), r.question, r.answer],
        }));
        refreshList();
        void qc.invalidateQueries({ queryKey: micoAiChatKey(id) });
      } catch (err) {
        setError(errorText(err));
        setDraft(text);
        // A chat made just for this question stays only if the question was asked.
        if (created && id) {
          await api.remove(id).catch(() => {});
          qc.removeQueries({ queryKey: micoAiChatKey(id) });
          goTo(null);
        }
        refreshList();
      } finally {
        setSending(false);
        box.current?.focus();
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

  const canAsk = ready && !pending && !sending;
  const questionBefore = (i: number) => [...messages.slice(0, i)].reverse().find((m) => m.role === 'user')?.text ?? '';
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  const list = (
    <ChatList
      chats={chats}
      activeId={chatId}
      query={query}
      onQuery={setQuery}
      onOpen={(id) => openChat(id)}
      onNew={() => {
        openChat(null);
        setTimeout(() => box.current?.focus(), 0);
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

  return (
    <div className="max-sm:-my-4 max-sm:mx-[-2.6316%]">
      <h1 className="sr-only">MICO AI</h1>
      <div
        ref={frameRef}
        style={frameOffset !== null ? ({ '--chat-top': `${frameOffset}px` } as React.CSSProperties) : undefined}
        className="chat-frame grid overflow-hidden border-line bg-surface [--chat-top:57px] sm:rounded-2xl sm:border sm:shadow-soft sm:[--chat-top:89px] lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] lg:[--chat-top:97px]"
      >
        <aside className="hidden min-h-0 border-e border-line bg-surface lg:flex lg:flex-col">{list}</aside>

        <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-col bg-ground/30">
          <header className="flex min-h-14 items-center gap-2 border-b border-line bg-surface px-3 py-2 sm:px-5">
            <button type="button" aria-label="Open chats" onClick={() => setDrawer(true)} className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line text-ink hover:bg-ground lg:hidden">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <ChatTitle key={chat?.id ?? 'new'} chat={chatId ? chat : null} onRename={(t) => chatId && void rename(chatId, t)} />
            <ul aria-label="MICO AI reads" className="hidden flex-none items-center gap-1.5 md:flex">
              {SCOPE.map((s) => (
                <li key={s} className="rounded-full bg-ground px-2.5 py-1 text-xs font-medium text-ink-2">{s}</li>
              ))}
            </ul>
            <button type="button" aria-label="New chat" onClick={() => openChat(null)} className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line text-ink hover:bg-ground lg:hidden">
              <PlusIcon size={16} />
            </button>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {!ready ? (
                <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink">{statusQ.data?.message ?? 'MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.'}</p>
              ) : null}
              {isGone ? (
                <p role="alert" className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink">This chat was deleted.</p>
              ) : null}
              {hasMore ? (
                <button type="button" onClick={() => void loadEarlier()} disabled={loadingEarlier} className="mx-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-ground disabled:opacity-60">
                  {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
                </button>
              ) : null}
              {chatId && chatQ.isError ? (
                <p className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">{errorText(chatQ.error)}</p>
              ) : null}
              {!chatId || (chatQ.isSuccess && messages.length === 0) ? (
                <div className="mx-auto flex max-w-md flex-col items-center gap-2 pt-6 text-center sm:pt-12">
                  <MicoAiMark size="lg" />
                  <h3 className="mt-2 font-display text-xl font-semibold text-ink">{firstName ? `How can I help, ${firstName}?` : 'How can I help?'}</h3>
                  <p className="text-sm text-ink-2">I answer from your tasks, projects, meetings, reports and team chat.</p>
                  <div className="mt-3 flex w-full flex-col gap-2">
                    {suggestedQuestions(projectName).map((q) => (
                      <button key={q} type="button" disabled={!canAsk} onClick={() => void send(q)} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-start text-sm text-ink transition-colors hover:border-brand/30 hover:bg-ground disabled:cursor-not-allowed disabled:opacity-60">
                        {q}
                      </button>
                    ))}
                  </div>
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
                    retry: () => void send(questionBefore(i)),
                    download: (n, f) => void download(m.id, n, f),
                    canAsk,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-line bg-surface px-3 pb-3 pt-2.5 sm:px-6">
            <form
              className="mx-auto max-w-3xl"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              {error ? (
                <p role="alert" dir="auto" className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
              ) : null}
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-2 shadow-soft focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                <textarea
                  ref={box}
                  rows={1}
                  dir="auto"
                  aria-label="Ask MICO AI"
                  placeholder={!ready ? 'MICO AI isn’t set up yet' : wide ? 'Ask about tasks, projects, meetings or reports…' : 'Ask MICO AI…'}
                  disabled={!ready}
                  maxLength={MAX_QUESTION}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (canAsk) void send(draft);
                    }
                  }}
                  className="max-h-[200px] min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
                />
                {pending ? (
                  <button type="button" onClick={() => void stop()} className="inline-flex h-9 flex-none items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-ground">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-ink" />
                    Stop
                  </button>
                ) : null}
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={!canAsk || !draft.trim()}
                  className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-brand-gradient text-white shadow-brand transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </svg>
                </button>
              </div>
              <p className="mt-1.5 text-center text-[11px] text-ink-3">MICO AI answers only from MICO360 data you can see, and links its sources. Check important figures before sharing.</p>
            </form>
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
