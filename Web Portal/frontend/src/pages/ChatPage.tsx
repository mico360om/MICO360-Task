import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { chatApi, type ApiChatAttachment, type ApiMessage, type ConversationPrefs, type ConversationSummary } from '../api/chat';
import { CHAT_INBOX_KEY, chatInboxQuery } from '../lib/chat-inbox-query';
import { withConversationRead } from '../lib/chat-badge';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { ApiError } from '../lib/api-client';
import { useAuthStore } from '../stores/auth-store';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useChatRealtime, type ChatEventPayload } from '../lib/useChatRealtime';
import { usePresence } from '../lib/usePresence';
import { useFrameOffset } from '../lib/useFrameOffset';
import { lastActiveLabel } from '../lib/lastActive';
import { isChatMuted, setChatMuted, primeAudio } from '../lib/notificationSound';
import { setViewingConversation } from '../lib/chat-sound';
import type { MentionPerson } from '../lib/mentions';
import {
  MAX_MESSAGE_LENGTH,
  buildTimeline,
  inboxSections,
  loadCollapsed,
  loadOutbox,
  mergeMessages,
  newClientId,
  receiptState,
  saveCollapsed,
  saveOutbox,
  validateAttachment,
  type InboxRow,
  type PendingMessage,
  type ShownMessage,
} from '../lib/chat-model';
import { ChatSidebar, type SectionKey } from '../components/chat/ChatSidebar';
import { Composer } from '../components/chat/Composer';
import { MessageItem, type MessageActions } from '../components/chat/MessageItem';
import { MessageList } from '../components/chat/MessageList';
import { SearchResults } from '../components/chat/SearchResults';
import { ConnectionBanner, ConversationHeader, ImageViewer, MembersPanel, type MemberRow } from '../components/chat/parts';
import { CloseIcon, SearchIcon } from '../components/chat/icons';
import { Icon } from '../components/meeting/kit';

export { MAX_MESSAGE_LENGTH };

/** Messages per history page (matches the server's default page size). */
export const CHAT_PAGE_SIZE = 50;

const NO_PREFS: ConversationPrefs = { favorite: false, archived: false, muted: false };
/** How long a message found by search or a reply's quote stays marked. */
const HIGHLIGHT_MS = 2500;

type Pages = InfiniteData<ApiMessage[], string | undefined>;

interface ActiveConversation {
  id: string;
  kind: 'PROJECT' | 'DIRECT';
  projectId?: string;
  /** For DMs: the other person (their name, avatar and presence). */
  partnerId?: string;
}

/** A readable error: our sentence, plus the server's reason for a rejected (4xx) request. */
function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return `${fallback} ${err.message}`;
    return fallback;
  }
  if (err instanceof TypeError) return `${fallback} Check your connection and try again.`;
  return fallback;
}

/** The short reason shown under a message that wasn't sent. */
function reasonOf(err: unknown): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  if (err instanceof TypeError) return 'Couldn’t reach the server.';
  return 'The server had a problem.';
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** A name inside a sentence keeps its own direction (Arabic in English text, or the other way round). */
const isolate = (name: string) => `⁨${name}⁩`;

/** "Message #Channel" — kept short so the empty box stays one line. */
function placeholderFor(kind: 'PROJECT' | 'DIRECT', title: string): string {
  const name = isolate(title.length > 22 ? `${title.slice(0, 20).trim()}…` : title);
  return kind === 'PROJECT' ? `Message #${name}` : `Message ${name}`;
}

export interface ChatPageProps {
  /** Open (or start) the direct conversation with this person — e.g. chosen from the global search. */
  startDirectWith?: string | null;
  /** Open this conversation (a channel or a direct one) — e.g. from a notification about it. */
  openConversationId?: string | null;
  /** Called once what was asked for has been opened, so the request is not repeated. */
  onOpened?: () => void;
}

export function ChatPage({ startDirectWith, openConversationId, onOpened }: ChatPageProps = {}) {
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? '';
  const isAdmin = (me?.roles ?? []).includes('ADMIN');
  const qc = useQueryClient();
  const online = usePresence();
  const isOnline = useCallback((userId?: string | null): boolean => !!userId && online.has(userId), [online]);
  const frameRef = useRef<HTMLDivElement>(null);
  const frameOffset = useFrameOffset(frameRef);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const inboxQ = useQuery(chatInboxQuery);
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() }); // shared key — one cache entry app-wide

  const projects = useMemo(() => (Array.isArray(projectsQ.data) ? projectsQ.data : []), [projectsQ.data]);
  const inbox = useMemo(() => (Array.isArray(inboxQ.data) ? inboxQ.data : []), [inboxQ.data]);
  const directory = useMemo(() => (Array.isArray(dirQ.data) ? dirQ.data : []), [dirQ.data]);
  const people = useMemo(() => new Map(directory.map((u) => [u.id, u])), [directory]);

  /** Someone's full name (yours too). */
  const fullName = useCallback((userId: string): string => {
    const u = people.get(userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : userId === myId ? 'You' : 'Someone';
  }, [people, myId]);
  /** As shown on messages: "You" for your own. */
  const nameOf = useCallback((userId: string): string => (userId === myId ? 'You' : fullName(userId)), [fullName, myId]);
  const avatarOf = useCallback((userId: string): string | null => (userId === myId ? me?.avatarUrl ?? null : people.get(userId)?.avatarUrl ?? null), [people, myId, me?.avatarUrl]);
  const projectOf = useCallback((projectId?: string) => projects.find((p) => p.id === projectId), [projects]);

  // ── What is open ──
  const [active, setActive] = useState<ActiveConversation | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [openError, setOpenError] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [unreadAfter, setUnreadAfter] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reply, setReply] = useState<ShownMessage | null>(null);
  const [restore, setRestore] = useState<{ conversationId: string; text: string; n: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [convQuery, setConvQuery] = useState('');
  const [showConvResults, setShowConvResults] = useState(true);
  const [membersOpen, setMembersOpen] = useState(false);
  const [jump, setJump] = useState<{ conversationId: string; id: string } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ShownMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ApiChatAttachment | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);

  // ── Sidebar ──
  const [query, setQuery] = useState('');
  const [messageSearch, setMessageSearch] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadCollapsed());
  const [dmOpen, setDmOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(() => !isChatMuted());

  // ── Notices ──
  const [toast, setToast] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const showToast = useCallback((text: string, tone: 'error' | 'info' = 'error') => setToast({ text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'info' ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // The sound notifier stays quiet for the conversation open in front of you.
  useEffect(() => {
    setViewingConversation(active?.id ?? null);
  }, [active?.id]);
  useEffect(() => () => setViewingConversation(null), []);

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightId]);

  // ── Messages: paged history, newest page first ──
  const messagesQ = useInfiniteQuery({
    queryKey: ['chat', 'messages', active?.id],
    queryFn: ({ pageParam }) => chatApi(apiClient).messages(active!.id, pageParam, CHAT_PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ApiMessage[]) => (Array.isArray(lastPage) && lastPage.length >= CHAT_PAGE_SIZE ? lastPage[0]?.createdAt : undefined),
    enabled: !!active,
  });

  // Messages on their way. Text ones are also kept in the browser until the server has them, so
  // leaving the page or a reload never loses what was written offline.
  const [pending, setPending] = useState<PendingMessage[]>(() => (myId ? loadOutbox(myId) : []));
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    if (myId) saveOutbox(myId, pending);
  }, [pending, myId]);
  const activePending = useMemo(() => pending.filter((p) => p.conversationId === active?.id), [pending, active?.id]);
  const shown = useMemo(
    () => mergeMessages((messagesQ.data?.pages ?? []).map((pg) => (Array.isArray(pg) ? pg : [])), activePending, myId),
    [messagesQ.data, activePending, myId],
  );
  const timeline = useMemo(() => buildTimeline(shown, { myId, unreadAfter }), [shown, myId, unreadAfter]);
  const lastId = shown[shown.length - 1]?.id;

  const activeSummary = inbox.find((s) => s.conversation.id === active?.id);
  const activePrefs = activeSummary?.prefs ?? NO_PREFS;

  // ── Cache edits (live events and our own changes land here without reloading the history) ──
  const patchPages = useCallback((conversationId: string, fn: (pages: ApiMessage[][]) => ApiMessage[][]) => {
    qc.setQueryData<Pages>(['chat', 'messages', conversationId], (old) => (old ? { ...old, pages: fn(old.pages.map((p) => (Array.isArray(p) ? p : []))) } : old));
  }, [qc]);
  const upsertMessage = useCallback((conversationId: string, msg: ApiMessage) => {
    patchPages(conversationId, (pages) => {
      let found = false;
      const next = pages.map((page) => page.map((x) => (x.id === msg.id ? ((found = true), { ...x, ...msg }) : x)));
      if (!found) next[0] = [...(next[0] ?? []), msg].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return next;
    });
  }, [patchPages]);
  const updateMessage = useCallback((conversationId: string, id: string, fn: (m: ApiMessage) => ApiMessage) => {
    patchPages(conversationId, (pages) => pages.map((page) => page.map((x) => (x.id === id ? fn(x) : x))));
  }, [patchPages]);
  const hasMessages = (conversationId: string) => !!qc.getQueryData<Pages>(['chat', 'messages', conversationId]);

  // ── Live updates ──
  const onRealtime = (event: string, payload: ChatEventPayload) => {
    void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    // Receipts come from the inbox summary; your settings and your projects need no message refresh.
    if (event === 'chat:read' || event === 'chat:delivered' || event === 'chat:prefs' || event === 'project:removed') return;
    const cid = typeof payload.conversationId === 'string' ? payload.conversationId : undefined;
    if (!cid) {
      void qc.invalidateQueries({ queryKey: ['chat', 'messages'] });
      return;
    }
    if (!hasMessages(cid)) return; // not loaded: it loads fresh when opened
    const msg = payload.message as ApiMessage | undefined;
    if (event === 'chat:message' && msg?.id) {
      upsertMessage(cid, complete(msg));
    } else if (event === 'chat:message:edited' && msg?.id) {
      updateMessage(cid, msg.id, (x) => ({ ...x, body: msg.body, editedAt: msg.editedAt }));
    } else if (event === 'chat:message:deleted' && typeof payload.id === 'string') {
      updateMessage(cid, payload.id, (x) => ({ ...x, body: '', deletedAt: x.deletedAt ?? new Date().toISOString(), attachments: [], reactions: [] }));
    } else if (event === 'chat:reaction' && typeof payload.messageId === 'string' && typeof payload.emoji === 'string' && typeof payload.userId === 'string') {
      const { messageId, emoji, userId, op } = payload as { messageId: string; emoji: string; userId: string; op?: string };
      updateMessage(cid, messageId, (x) => ({ ...x, reactions: applyReaction(x.reactions, emoji, userId, op !== 'remove') }));
    } else {
      void qc.invalidateQueries({ queryKey: ['chat', 'messages', cid] });
    }
  };
  // After a dropped connection comes back, refetch everything we may have missed.
  const refetchAfterReconnect = () => {
    void qc.invalidateQueries({ queryKey: ['chat'] });
    void qc.invalidateQueries({ queryKey: ['directory'] });
  };
  const connection = useChatRealtime(projects.map((p) => p.id), onRealtime, refetchAfterReconnect);

  // Presence changed: lastActiveAt moved server-side; refresh the directory for "last active" labels.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['directory'] });
  }, [online, qc]);

  // ── Read state ──
  const markRead = useCallback((conversationId: string) => {
    // Show it read at once (the Chat menu's badge too), so leaving it can't flash its old count.
    qc.setQueryData<ConversationSummary[]>(CHAT_INBOX_KEY, (old) => withConversationRead(old, conversationId));
    void chatApi(apiClient)
      .markRead(conversationId)
      .then(() => qc.invalidateQueries({ queryKey: ['chat', 'conversations'] }))
      .catch(() => {}); // best effort — the badge just stays until the next successful read
  }, [qc]);
  // Messages that arrive while you look at the conversation are read: mark them (debounced).
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const activeUnread = activeSummary?.unread ?? 0;
  useEffect(() => {
    if (!active || !pageVisible || activeUnread === 0) return;
    const t = setTimeout(() => markRead(active.id), 800);
    return () => clearTimeout(t);
  }, [active?.id, activeUnread, pageVisible, lastId]);

  // ── Opening conversations ──
  function switchTo(next: ActiveConversation, summary?: ConversationSummary) {
    const s = summary ?? inbox.find((x) => x.conversation.id === next.id);
    const mine = s?.participants.find((p) => p.userId === myId);
    setUnreadAfter(s && s.unread > 0 ? mine?.lastReadAt ?? new Date(0).toISOString() : null);
    setActive(next);
    setOpenError(null);
    setEditingId(null);
    setReply(null);
    setSearchOpen(false);
    setConvQuery('');
    setDmOpen(false);
  }
  function backToList() {
    setActive(null);
    setOpenError(null);
    setEditingId(null);
    setReply(null);
    setMembersOpen(false);
  }

  async function openChannel(projectId: string): Promise<string | null> {
    const title = projects.find((p) => p.id === projectId)?.name ?? 'this channel';
    setOpenError(null);
    setOpeningKey(`p-${projectId}`);
    try {
      const { conversation } = await chatApi(apiClient).openProjectChannel(projectId);
      switchTo({ id: conversation.id, kind: 'PROJECT', projectId });
      markRead(conversation.id);
      return conversation.id;
    } catch (err) {
      setActive(null);
      setOpenError(
        err instanceof ApiError && err.status === 403
          ? `You can’t open #${title} because you aren’t a member of this project. Ask the project’s manager to add you to the team.`
          : errorText(err, `Couldn’t open #${title}.`),
      );
      return null;
    } finally {
      setOpeningKey(null);
    }
  }
  async function openDirect(userId: string) {
    try {
      const conv = await chatApi(apiClient).startDirect(userId);
      switchTo({ id: conv.id, kind: 'DIRECT', partnerId: userId });
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      markRead(conv.id);
    } catch (err) {
      showToast(errorText(err, `Couldn’t start a conversation with ${fullName(userId)}.`));
    }
  }
  /** Open a conversation from the inbox (a notification, a search result). */
  async function openSummary(summary: ConversationSummary) {
    if (summary.conversation.kind === 'PROJECT' && summary.conversation.projectId) {
      await openChannel(summary.conversation.projectId);
      return;
    }
    const partnerId = summary.participants.find((pt) => pt.userId !== myId)?.userId;
    switchTo({ id: summary.conversation.id, kind: 'DIRECT', partnerId }, summary);
    markRead(summary.conversation.id);
  }
  function openRow(row: InboxRow) {
    setMessageSearch(false);
    if (row.kind === 'PROJECT' && row.projectId) {
      void openChannel(row.projectId);
    } else if (row.conversationId) {
      switchTo({ id: row.conversationId, kind: 'DIRECT', partnerId: row.partnerId });
      markRead(row.conversationId);
    }
  }
  async function findSummary(conversationId: string): Promise<ConversationSummary | undefined> {
    const known = inbox.find((s) => s.conversation.id === conversationId);
    if (known) return known;
    // It may be newer than the list as loaded (a first message from someone new): fetch it again.
    const r = await inboxQ.refetch();
    return (Array.isArray(r.data) ? r.data : []).find((s) => s.conversation.id === conversationId);
  }
  async function openSearchResult(m: ApiMessage) {
    const summary = await findSummary(m.conversationId);
    if (!summary) {
      showToast('That conversation couldn’t be opened.');
      return;
    }
    await openSummary(summary);
    setJump({ conversationId: m.conversationId, id: m.id });
  }

  // Asked from outside (a person picked in the search): open once the names are loaded.
  const directoryReady = dirQ.isSuccess;
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!startDirectWith) { startedFor.current = null; return; }
    if (!directoryReady || startedFor.current === startDirectWith) return;
    startedFor.current = startDirectWith;
    void openDirect(startDirectWith).finally(() => onOpened?.());
    // Runs once per request: openDirect reads the current state itself.
  }, [startDirectWith, directoryReady]);

  // Asked to open a conversation by its id (a notification).
  const listsReady = directoryReady && inboxQ.isSuccess && projectsQ.isSuccess;
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!openConversationId) { openedFor.current = null; return; }
    if (!listsReady || openedFor.current === openConversationId) return;
    openedFor.current = openConversationId;
    void findSummary(openConversationId).then(async (summary) => {
      if (summary) await openSummary(summary);
      else {
        setActive(null);
        setOpenError('This conversation couldn’t be found. It may have been removed.');
      }
      onOpened?.();
    });
    // Runs once per request, when the lists it needs have loaded.
  }, [openConversationId, listsReady]);

  // ── Sending (each message keeps one id through retries, so the server never stores it twice) ──
  const filesRef = useRef(new Map<string, File>());
  const inFlight = useRef(new Set<string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const updatePending = useCallback((clientId: string, patch: (p: PendingMessage) => Partial<PendingMessage>) => {
    setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, ...patch(p) } : p)));
  }, []);
  const dropPending = useCallback((clientId: string) => {
    const p = pendingRef.current.find((x) => x.clientId === clientId);
    for (const f of p?.files ?? []) if (f.previewUrl) URL.revokeObjectURL?.(f.previewUrl);
    filesRef.current.delete(clientId);
    setPending((list) => list.filter((x) => x.clientId !== clientId));
  }, []);

  async function deliverNow(p: PendingMessage) {
    if (inFlight.current.has(p.clientId)) return;
    inFlight.current.add(p.clientId);
    updatePending(p.clientId, () => ({ state: 'sending', error: undefined }));
    const file = filesRef.current.get(p.clientId);
    try {
      const api = chatApi(apiClient);
      const opts = { clientId: p.clientId, replyToId: p.replyTo?.id };
      const saved = file
        ? await api.uploadAttachment(p.conversationId, file, p.body || undefined, {
          ...opts,
          onProgress: (f) => updatePending(p.clientId, (cur) => ({ files: cur.files.map((x) => ({ ...x, progress: f })) })),
        })
        : await api.send(p.conversationId, p.body, opts);
      upsertMessage(p.conversationId, complete(saved));
      // The stand-in goes once the saved copy is on screen (below) — never a moment with neither.
      // A conversation not loaded here has nothing on screen to swap.
      if (!hasMessages(p.conversationId) || saved.clientId !== p.clientId) dropPending(p.clientId);
      else setTimeout(() => dropPending(p.clientId), 3000);
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    } catch (err) {
      if (err instanceof TypeError && isOffline()) {
        updatePending(p.clientId, () => ({ state: 'queued' }));
      } else {
        updatePending(p.clientId, () => ({ state: 'failed', error: reasonOf(err) }));
        showToast(errorText(err, file ? `Couldn’t upload “${file.name}”.` : 'Your message wasn’t sent.'));
      }
    } finally {
      inFlight.current.delete(p.clientId);
    }
  }
  /** One at a time, in the order written. */
  const deliver = (p: PendingMessage) => {
    chain.current = chain.current.then(() => deliverNow(p));
    return chain.current;
  };
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  // Sent messages whose saved copy has arrived in the history: their stand-ins are done.
  useEffect(() => {
    const confirmed = new Set((messagesQ.data?.pages ?? []).flatMap((pg) => (Array.isArray(pg) ? pg : [])).map((m) => m.clientId).filter(Boolean));
    for (const p of pendingRef.current) if (confirmed.has(p.clientId) && !inFlight.current.has(p.clientId)) dropPending(p.clientId);
  }, [messagesQ.data, dropPending]);

  // Back online (or the live connection is back): send what was waiting.
  const flushQueued = useCallback(() => {
    for (const p of pendingRef.current) if (p.state === 'queued') void deliverRef.current(p);
  }, []);
  useEffect(() => {
    window.addEventListener('online', flushQueued);
    return () => window.removeEventListener('online', flushQueued);
  }, [flushQueued]);
  useEffect(() => {
    if (connection === 'connected') flushQueued();
  }, [connection, flushQueued]);
  // Kept from an earlier visit: send them now if we can.
  useEffect(() => {
    if (!isOffline()) flushQueued();
  }, [flushQueued]);

  function enqueue(conversationId: string, body: string, file?: File): PendingMessage {
    const p: PendingMessage = {
      clientId: newClientId(),
      conversationId,
      body,
      createdAt: new Date().toISOString(),
      state: isOffline() ? 'queued' : 'sending',
      replyTo: reply ? { id: reply.id, userId: reply.userId, body: reply.body.slice(0, 200), deleted: !!reply.deletedAt } : null,
      files: file
        ? [{ name: file.name, size: file.size, type: file.type, progress: 0, previewUrl: file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined }]
        : [],
    };
    if (file) filesRef.current.set(p.clientId, file);
    setPending((list) => [...list, p]);
    if (p.state === 'sending') void deliver(p);
    return p;
  }

  function sendText(body: string): boolean {
    const text = body.trim();
    if (!text || !active) return false;
    if (text.length > MAX_MESSAGE_LENGTH) {
      showToast(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters. This one has ${text.length.toLocaleString()}.`);
      return false;
    }
    enqueue(active.id, text);
    setReply(null);
    return true;
  }
  function sendFiles(files: File[], caption: string): boolean {
    if (!active) return false;
    const problems = files.map((f) => validateAttachment(f)).filter((x): x is string => !!x);
    if (problems.length) showToast(problems.join(' '));
    const ok = files.filter((f) => !validateAttachment(f));
    if (ok.length === 0) return false;
    if (caption.length > MAX_MESSAGE_LENGTH) {
      showToast(`Captions can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`);
      return false;
    }
    ok.forEach((file, i) => enqueue(active.id, i === 0 ? caption : '', file));
    setReply(null);
    return true;
  }

  // ── Message actions ──
  const handlers = {
    reply: (m: ShownMessage) => setReply(m),
    react: (m: ShownMessage, emoji: string) => {
      const mine = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(myId);
      updateMessage(m.conversationId, m.id, (x) => ({ ...x, reactions: applyReaction(x.reactions, emoji, myId, !mine) }));
      const api = chatApi(apiClient);
      (mine ? api.removeReaction(m.id, emoji) : api.addReaction(m.id, emoji)).catch((err) => {
        void qc.invalidateQueries({ queryKey: ['chat', 'messages', m.conversationId] });
        showToast(errorText(err, 'Couldn’t update the reaction.'));
      });
    },
    copy: (m: ShownMessage) => {
      const done = () => showToast('Copied', 'info');
      const fail = () => showToast('Couldn’t copy the message.');
      try {
        const p = navigator.clipboard?.writeText(m.body);
        if (p) void p.then(done, fail);
        else fail();
      } catch {
        fail();
      }
    },
    startEdit: (m: ShownMessage) => setEditingId(m.id),
    cancelEdit: () => setEditingId(null),
    saveEdit: async (id: string, body: string): Promise<boolean> => {
      const text = body.trim();
      if (!text) {
        showToast('A message can’t be empty — delete it instead.');
        return false;
      }
      if (text.length > MAX_MESSAGE_LENGTH) {
        showToast(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters. This one has ${text.length.toLocaleString()}.`);
        return false;
      }
      try {
        const saved = await chatApi(apiClient).edit(id, text);
        const cid = activeRef.current?.id;
        if (cid) updateMessage(cid, id, (x) => ({ ...x, body: saved.body, editedAt: saved.editedAt ?? new Date().toISOString() }));
        setEditingId(null); // close only once the edit is saved
        return true;
      } catch (err) {
        showToast(errorText(err, 'Your edit wasn’t saved — it’s still open so you can try again.'));
        return false;
      }
    },
    remove: (m: ShownMessage) => {
      setDeleteError(null);
      setConfirmDelete(m);
    },
    retry: (m: ShownMessage) => {
      const p = pendingRef.current.find((x) => x.clientId === m.clientId);
      if (p) void deliver(p);
    },
    discard: (m: ShownMessage) => {
      if (m.clientId) dropPending(m.clientId);
    },
    editUnsent: (m: ShownMessage) => {
      if (m.clientId) dropPending(m.clientId);
      setRestore((r) => ({ conversationId: m.conversationId, text: m.body, n: (r?.n ?? 0) + 1 }));
    },
    jumpTo: (id: string) => {
      const cid = activeRef.current?.id;
      if (cid) setJump({ conversationId: cid, id });
    },
    openImage: (a: ApiChatAttachment) => setViewing(a),
    reveal: (id: string | null) => setRevealedId(id),
  };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  // One object for every row, so typing or a new message elsewhere doesn't redraw the whole thread.
  const actions = useMemo<MessageActions>(() => ({
    reply: (m) => handlersRef.current.reply(m),
    react: (m, e) => handlersRef.current.react(m, e),
    copy: (m) => handlersRef.current.copy(m),
    startEdit: (m) => handlersRef.current.startEdit(m),
    saveEdit: (id, body) => handlersRef.current.saveEdit(id, body),
    cancelEdit: () => handlersRef.current.cancelEdit(),
    remove: (m) => handlersRef.current.remove(m),
    retry: (m) => handlersRef.current.retry(m),
    discard: (m) => handlersRef.current.discard(m),
    editUnsent: (m) => handlersRef.current.editUnsent(m),
    jumpTo: (id) => handlersRef.current.jumpTo(id),
    openImage: (a) => handlersRef.current.openImage(a),
    reveal: (id) => handlersRef.current.reveal(id),
  }), []);

  async function confirmRemove() {
    const m = confirmDelete;
    if (!m) return;
    setDeleting(true);
    try {
      await chatApi(apiClient).remove(m.id);
      updateMessage(m.conversationId, m.id, (x) => ({ ...x, body: '', deletedAt: new Date().toISOString(), attachments: [], reactions: [] }));
      setConfirmDelete(null);
    } catch (err) {
      setDeleteError(errorText(err, 'Couldn’t delete the message.'));
    } finally {
      setDeleting(false);
    }
  }

  // ── Per-conversation settings ──
  const applyPrefs = useCallback((target: { id: string; kind: 'PROJECT' | 'DIRECT'; projectId?: string }, prefs: Partial<ConversationPrefs>) => {
    qc.setQueryData<ConversationSummary[]>(['chat', 'conversations'], (old) => {
      const list = Array.isArray(old) ? old : [];
      if (list.some((s) => s.conversation.id === target.id)) {
        return list.map((s) => (s.conversation.id === target.id ? { ...s, prefs: { ...NO_PREFS, ...s.prefs, ...prefs } } : s));
      }
      return [...list, { conversation: { id: target.id, kind: target.kind, projectId: target.projectId ?? null, createdAt: '' }, participants: [], unread: 0, lastMessage: null, prefs: { ...NO_PREFS, ...prefs } }];
    });
  }, [qc]);
  async function changePrefs(target: { conversationId: string | null; kind: 'PROJECT' | 'DIRECT'; projectId?: string }, patch: Partial<ConversationPrefs>) {
    try {
      const id = target.conversationId ?? (target.projectId ? (await chatApi(apiClient).openProjectChannel(target.projectId)).conversation.id : null);
      if (!id) return;
      applyPrefs({ id, kind: target.kind, projectId: target.projectId }, patch); // at once; the server confirms below
      const saved = await chatApi(apiClient).setPrefs(id, patch);
      applyPrefs({ id, kind: target.kind, projectId: target.projectId }, saved);
    } catch (err) {
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      showToast(errorText(err, 'Couldn’t change that setting.'));
    }
  }
  const changeActivePrefs = (patch: Partial<ConversationPrefs>) =>
    active && void changePrefs({ conversationId: active.id, kind: active.kind, projectId: active.projectId }, patch);

  function toggleSound() {
    primeAudio(); // this click is a user gesture — unlock audio for future chimes
    const next = !soundOn;
    setChatMuted(!next);
    setSoundOn(next);
  }
  function toggleSection(key: SectionKey) {
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      saveCollapsed(next);
      return next;
    });
  }

  // ── What the page shows ──
  const sections = useMemo(() => inboxSections({ inbox, projects, myId, nameOf: fullName, query }), [inbox, projects, myId, fullName, query]);
  const activeKey = active ? (active.kind === 'PROJECT' ? `p-${active.projectId}` : `d-${active.id}`) : null;
  const activeTitle = !active ? '' : active.kind === 'PROJECT' ? projects.find((p) => p.id === active.projectId)?.name ?? 'Project channel' : active.partnerId ? fullName(active.partnerId) : 'Direct message';
  const titleOf = useCallback((conversationId: string) => {
    const s = inbox.find((x) => x.conversation.id === conversationId);
    if (!s) return 'Conversation';
    if (s.conversation.kind === 'PROJECT') return projects.find((p) => p.id === s.conversation.projectId)?.name ?? 'Project channel';
    const other = s.participants.find((p) => p.userId !== myId)?.userId;
    return other ? fullName(other) : 'Direct message';
  }, [inbox, projects, myId, fullName]);

  const membersQ = useQuery({
    queryKey: ['chat', 'members', active?.id],
    queryFn: () => chatApi(apiClient).members(active!.id),
    enabled: !!active && active.kind === 'PROJECT',
  });
  const memberIds = useMemo(() => {
    if (!active) return [];
    if (active.kind === 'DIRECT') return [myId, ...(active.partnerId ? [active.partnerId] : [])];
    return Array.isArray(membersQ.data) ? membersQ.data : [];
  }, [active, membersQ.data, myId]);
  const memberRows = useMemo<MemberRow[]>(() =>
    memberIds
      .map((id) => ({
        id,
        name: fullName(id),
        username: people.get(id)?.username,
        avatarUrl: avatarOf(id),
        online: id === myId || isOnline(id),
        presence: id === myId ? 'Active now' : lastActiveLabel(people.get(id)?.lastActiveAt ?? null, isOnline(id)),
        me: id === myId,
      }))
      .sort((a, b) => Number(b.me) - Number(a.me) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
  [memberIds, fullName, people, avatarOf, myId, isOnline]);

  // @mentions: the conversation's members (everyone in the directory until they are known).
  const mentionPeople = useMemo<MentionPerson[]>(() => {
    const ids = memberIds.length > 1 ? memberIds : directory.map((u) => u.id);
    return ids
      .filter((id) => id !== myId)
      .map((id) => people.get(id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({ id: u.id, username: u.username, name: `${u.firstName} ${u.lastName}`.trim(), avatarUrl: u.avatarUrl }));
  }, [memberIds, directory, people, myId]);
  const knownUsernames = useMemo(() => directory.map((u) => u.username), [directory]);

  const partnerOnline = isOnline(active?.partnerId);
  const subtitle = !active
    ? ''
    : active.kind === 'DIRECT'
      ? lastActiveLabel(people.get(active.partnerId ?? '')?.lastActiveAt ?? null, partnerOnline)
      : memberIds.length
        ? `Project channel · ${memberIds.length} members${memberRows.filter((m) => m.online && !m.me).length ? ` · ${memberRows.filter((m) => m.online && !m.me).length} online` : ''}`
        : 'Project channel';

  const participants = activeSummary?.participants ?? [];
  const renderMessage = (entry: Extract<ReturnType<typeof buildTimeline>[number], { type: 'message' }>) => {
    const m = entry.message;
    const mine = m.userId === myId;
    return (
      <MessageItem
        m={m}
        mine={mine}
        groupStart={entry.groupStart}
        groupEnd={entry.groupEnd}
        authorName={nameOf(m.userId)}
        authorAvatar={avatarOf(m.userId)}
        receipt={mine && active ? receiptState(m, { myId, kind: active.kind, participants, isOnline }) : undefined}
        canEdit={mine && !m.pending}
        canDelete={!m.pending && (mine || isAdmin)}
        editing={editingId === m.id}
        highlighted={highlightId === m.id}
        revealed={revealedId === m.id}
        myId={myId}
        myUsername={me?.username ?? ''}
        knownUsernames={knownUsernames}
        nameOf={nameOf}
        actions={actions}
      />
    );
  };

  const dmOptions = directory
    .filter((u) => u.id !== myId)
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }));

  const showThread = active !== null || openError !== null;
  const waiting = pending.filter((p) => p.state === 'queued').length;

  return (
    <div className="max-sm:-my-4 max-sm:mx-[-2.6316%]">
      {/* On a phone an open conversation gets the whole screen: the list (with the page's heading)
          steps aside, and a hidden stand-in keeps the main heading for screen readers. */}
      {showThread ? <h1 className="sr-only lg:hidden">Chat</h1> : null}
      <div
        className="chat-frame grid overflow-hidden border-line bg-surface [--chat-top:56px] sm:rounded-2xl sm:border sm:shadow-soft sm:[--chat-top:88px] lg:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)] lg:[--chat-top:96px]"
        ref={frameRef}
        style={frameOffset !== null ? ({ '--chat-top': `${frameOffset}px` } as React.CSSProperties) : undefined}
      >
        <ChatSidebar
          hidden={showThread}
          sections={sections}
          activeKey={activeKey}
          openingKey={openingKey}
          query={query}
          onQuery={(q) => { setQuery(q); if (q.trim().length < 2) setMessageSearch(false); }}
          messageSearch={messageSearch}
          onMessageSearch={setMessageSearch}
          onPickResult={(m) => void openSearchResult(m)}
          titleOf={titleOf}
          collapsed={collapsed}
          onToggleSection={toggleSection}
          onOpen={openRow}
          onPrefs={(row, patch) => void changePrefs({ conversationId: row.conversationId, kind: row.kind, projectId: row.projectId }, patch)}
          myId={myId}
          nameOf={fullName}
          avatarOf={avatarOf}
          isOnline={isOnline}
          projectOf={projectOf}
          soundOn={soundOn}
          onToggleSound={toggleSound}
          dmOpen={dmOpen}
          onToggleDm={() => setDmOpen((v) => !v)}
          dmOptions={dmOptions}
          onStartDm={(id) => void openDirect(id)}
          loadingProjects={projectsQ.isLoading}
          loadingInbox={inboxQ.isLoading}
          projectsError={projectsQ.isError ? () => void projectsQ.refetch() : null}
          inboxError={inboxQ.isError ? () => void inboxQ.refetch() : null}
        />

        <section aria-label={active ? activeTitle : 'Conversation'} className={`relative min-h-0 min-w-0 flex-col bg-ground/40 ${showThread ? 'flex' : 'hidden lg:flex'}`}>
          {!active ? (
            openError ? (
              <div className="grid h-full place-items-center p-8 text-center">
                <div className="max-w-sm">
                  <p className="font-semibold text-ink">This conversation couldn’t be opened</p>
                  <p role="alert" dir="auto" className="mt-2 text-sm text-danger">{openError}</p>
                  <button type="button" onClick={backToList} className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-ground lg:hidden">
                    Back to conversations
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid h-full place-items-center">
                <EmptyState bare title="Select a conversation" description="Pick a project channel or a direct message to start chatting." />
              </div>
            )
          ) : (
            <>
              <ConversationHeader
                title={activeTitle}
                kind={active.kind}
                avatarUrl={active.partnerId ? avatarOf(active.partnerId) : null}
                project={projectOf(active.projectId)}
                online={partnerOnline}
                subtitle={subtitle}
                subtitleTone={active.kind === 'DIRECT' && partnerOnline ? 'online' : 'plain'}
                prefs={activePrefs}
                searchOpen={searchOpen}
                membersOpen={membersOpen}
                onBack={backToList}
                onToggleSearch={() => { setSearchOpen((v) => !v); setConvQuery(''); }}
                onToggleMembers={() => setMembersOpen((v) => !v)}
                onToggleMute={() => changeActivePrefs({ muted: !activePrefs.muted })}
                onToggleFavorite={() => changeActivePrefs({ favorite: !activePrefs.favorite })}
              />
              <ConnectionBanner status={connection} waiting={waiting} />
              {searchOpen ? (
                <div className="relative z-20 flex-none border-b border-line bg-surface px-3 py-2 sm:px-4">
                  <label className="relative block">
                    <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-2"><SearchIcon size={16} /></span>
                    <input
                      type="search"
                      autoFocus
                      value={convQuery}
                      onChange={(e) => { setConvQuery(e.target.value); setShowConvResults(true); }}
                      onFocus={() => setShowConvResults(true)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setSearchOpen(false); } }}
                      aria-label="Search this conversation"
                      placeholder={`Search in ${isolate(activeTitle)}`}
                      className="w-full rounded-xl border border-line bg-ground py-2 pe-10 ps-9 text-sm text-ink outline-none focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/20"
                    />
                    <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="absolute inset-y-0 end-1 my-auto grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:text-ink">
                      <CloseIcon size={15} />
                    </button>
                  </label>
                  {convQuery.trim() && showConvResults ? (
                    <div className="absolute inset-x-3 top-full z-20 mt-1 max-h-[min(22rem,50vh)] overflow-y-auto rounded-xl border border-line bg-surface shadow-lift sm:inset-x-4">
                      <SearchResults
                        q={convQuery}
                        conversationId={active.id}
                        nameOf={nameOf}
                        onPick={(m) => { setShowConvResults(false); setJump({ conversationId: m.conversationId, id: m.id }); }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <MessageList
                    key={`list-${active.id}`}
                    conversationId={active.id}
                    messages={shown}
                    timeline={timeline}
                    myId={myId}
                    loading={messagesQ.isLoading}
                    error={messagesQ.isError}
                    onRetry={() => void messagesQ.refetch()}
                    hasOlder={!!messagesQ.hasNextPage}
                    loadingOlder={messagesQ.isFetchingNextPage}
                    olderError={messagesQ.isFetchNextPageError}
                    onLoadOlder={() => void messagesQ.fetchNextPage()}
                    jumpTo={jump?.conversationId === active.id ? jump.id : null}
                    onJumped={(found) => {
                      if (found) setHighlightId(jump?.id ?? null);
                      else showToast('That message isn’t in this conversation any more.');
                      setJump(null);
                    }}
                    renderMessage={renderMessage}
                    empty={
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand">{Icon.chat}</span>
                        <p className="text-sm font-semibold text-ink">No messages yet</p>
                        <p className="text-xs text-ink-2">Say hello to get the conversation started.</p>
                      </div>
                    }
                  />
                  <Composer
                    key={`composer-${active.id}`}
                    conversationId={active.id}
                    placeholder={placeholderFor(active.kind, activeTitle)}
                    people={mentionPeople}
                    replyTo={reply ? { authorName: nameOf(reply.userId), body: reply.body.replace(/\s+/g, ' ') } : null}
                    onCancelReply={() => setReply(null)}
                    onSend={sendText}
                    onFiles={sendFiles}
                    restore={restore?.conversationId === active.id ? restore : null}
                  />
                </div>
                {membersOpen ? (
                  <MembersPanel
                    members={memberRows}
                    loading={active.kind === 'PROJECT' && membersQ.isLoading}
                    error={membersQ.isError}
                    onRetry={() => void membersQ.refetch()}
                    onMessage={(id) => { setMembersOpen(false); void openDirect(id); }}
                    onClose={() => setMembersOpen(false)}
                  />
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this message?"
          confirmLabel="Yes, delete"
          keepLabel="Keep"
          busy={deleting}
          error={deleteError}
          onConfirm={() => void confirmRemove()}
          onClose={() => setConfirmDelete(null)}
        >
          {confirmDelete.userId === myId ? 'It will be removed for everyone in the conversation.' : `${fullName(confirmDelete.userId)}’s message will be removed for everyone.`} This can’t be undone.
        </ConfirmDialog>
      ) : null}
      {viewing ? <ImageViewer attachment={viewing} onClose={() => setViewing(null)} /> : null}

      {toast ? (
        // Above the message box, so a notice never covers what you are typing.
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4">
          <div
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border bg-surface px-4 py-2.5 text-sm text-ink shadow-lift ${toast.tone === 'error' ? 'border-danger/30' : 'border-line'}`}
          >
            <span dir="auto" className="min-w-0 flex-1">{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="shrink-0 text-ink-2 hover:text-ink">✕</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A message from an event or a response, with the lists a page of history always has. */
function complete(m: ApiMessage): ApiMessage {
  return { ...m, reactions: Array.isArray(m.reactions) ? m.reactions : [], attachments: Array.isArray(m.attachments) ? m.attachments : [] };
}

/** Reactions after one person adds or takes back an emoji. */
function applyReaction(groups: ApiMessage['reactions'], emoji: string, userId: string, add: boolean): ApiMessage['reactions'] {
  const list = groups.map((g) => ({ ...g, userIds: [...g.userIds] }));
  const g = list.find((x) => x.emoji === emoji);
  if (add) {
    if (!g) list.push({ emoji, userIds: [userId] });
    else if (!g.userIds.includes(userId)) g.userIds.push(userId);
  } else if (g) {
    g.userIds = g.userIds.filter((id) => id !== userId);
  }
  return list.filter((x) => x.userIds.length > 0);
}
