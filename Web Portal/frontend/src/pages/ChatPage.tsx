import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { chatApi, fileUrl, type ApiMessage } from '../api/chat';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { useAuthStore } from '../stores/auth-store';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { useChatRealtime } from '../lib/useChatRealtime';
import { usePresence } from '../lib/usePresence';
import { lastActiveLabel } from '../lib/lastActive';
import { messageReceiptStatus, type ReceiptStatus } from '../lib/messageReceipt';
import { isChatMuted, setChatMuted, primeAudio } from '../lib/notificationSound';
import { detectMention, applyMention, tokenizeMentions } from '../lib/mentions';
import type { DirectoryUser } from '../api/users';

const QUICK_REACTIONS = ['👍', '❤️', '🎉', '✅', '😄'];

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
function dayLabel(iso: string): string {
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(iso, now.toISOString())) return 'Today';
  if (sameDay(iso, yesterday.toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Consecutive messages from one author within this window share a single header. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

type TimelineItem =
  | { type: 'day'; id: string; label: string }
  | { type: 'msg'; m: ApiMessage; showHeader: boolean };

/** Insert day dividers and mark the first message of each same-author burst so headers aren't repeated. */
function buildTimeline(messages: ApiMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
    if (newDay) items.push({ type: 'day', id: `day-${m.id}`, label: dayLabel(m.createdAt) });
    const grouped =
      !newDay &&
      !!prev &&
      prev.userId === m.userId &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <= GROUP_WINDOW_MS;
    items.push({ type: 'msg', m, showHeader: !grouped });
  });
  return items;
}

interface ActiveConversation {
  id: string;
  kind: 'PROJECT' | 'DIRECT';
  projectId?: string;
  title: string;
  avatarUrl?: string | null;
  /** For DMs: the other participant's user id (drives their online indicator). */
  partnerId?: string;
}

export function ChatPage() {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const online = usePresence();
  const isOnline = (userId?: string | null): boolean => !!userId && online.has(userId);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const inboxQ = useQuery({ queryKey: ['chat', 'conversations'], queryFn: () => chatApi(apiClient).conversations() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() }); // shared key — one cache entry app-wide

  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const inbox = inboxQ.data ?? [];
  const directory = dirQ.data ?? [];

  const nameOf = (userId: string): string => {
    if (userId === me?.id) return 'You';
    const u = directory.find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Someone';
  };
  const avatarOf = (userId: string): string | null => {
    if (userId === me?.id) return me?.avatarUrl ?? null;
    return directory.find((d) => d.id === userId)?.avatarUrl ?? null;
  };

  const [active, setActive] = useState<ActiveConversation | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [showNewDm, setShowNewDm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [muted, setMuted] = useState(() => isChatMuted());
  const toggleMute = () => {
    primeAudio(); // this click is a user gesture — unlock audio for future chimes
    setMuted((m) => {
      const next = !m;
      setChatMuted(next);
      return next;
    });
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // @mention autocomplete state.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const knownUsernames = useMemo(() => new Set(directory.map((u) => u.username)), [directory]);
  const mentionMatches: DirectoryUser[] = mention
    ? directory
        .filter((u) => {
          const q = mention.query.toLowerCase();
          return q === '' || u.username.toLowerCase().includes(q) || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q);
        })
        .slice(0, 6)
    : [];

  function onDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDraft(value);
    const caret = e.target.selectionStart ?? value.length;
    setMention(detectMention(value, caret));
    setMentionIdx(0);
  }
  function pickMention(user: DirectoryUser) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    if (!mention) return;
    const { text, caret: nextCaret } = applyMention(draft, mention.start, user.username, caret);
    setDraft(text);
    setMention(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nextCaret, nextCaret);
    });
  }
  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => Math.min(i + 1, mentionMatches.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionMatches[mentionIdx] ?? mentionMatches[0]!); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  const messagesQ = useQuery({
    queryKey: ['chat', 'messages', active?.id],
    queryFn: () => chatApi(apiClient).messages(active!.id),
    enabled: !!active,
  });
  const messages = messagesQ.data ?? [];
  const timeline = useMemo(() => buildTimeline(messages), [messages]);

  // Read-receipt inputs for the active 1:1 conversation (from the inbox summary + directory + presence).
  const activeSummary = inbox.find((sm) => sm.conversation.id === active?.id);
  const otherParticipant = activeSummary?.participants.find((p) => p.userId !== me?.id);
  const otherPartner = directory.find((d) => d.id === active?.partnerId);
  const receiptFor = (msg: ApiMessage): ReceiptStatus | undefined => {
    if (active?.kind !== 'DIRECT' || msg.userId !== me?.id) return undefined;
    return messageReceiptStatus(
      { createdAt: msg.createdAt },
      { lastReadAt: otherParticipant?.lastReadAt ?? null, lastActiveAt: otherPartner?.lastActiveAt ?? null },
      isOnline(active?.partnerId),
    );
  };

  // Live updates: refetch the affected conversation + the inbox on any chat event.
  const realtime = () => {
    void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    if (active) void qc.invalidateQueries({ queryKey: ['chat', 'messages', active.id] });
  };
  useChatRealtime(projects.map((p) => p.id), realtime);

  // When anyone's presence changes their lastActiveAt moves server-side; refresh the directory
  // so the header's "last active" label and offline "delivered" receipts stay accurate.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['directory'] }); // presence changed → refresh directory
  }, [online, qc]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, active?.id]);

  const markRead = (conversationId: string) => {
    void chatApi(apiClient).markRead(conversationId).then(() => qc.invalidateQueries({ queryKey: ['chat', 'conversations'] }));
  };

  async function openChannel(projectId: string, title: string) {
    const { conversation } = await chatApi(apiClient).openProjectChannel(projectId);
    setActive({ id: conversation.id, kind: 'PROJECT', projectId, title });
    markRead(conversation.id);
  }
  async function openDirect(userId: string) {
    const conv = await chatApi(apiClient).startDirect(userId);
    setActive({ id: conv.id, kind: 'DIRECT', title: nameOf(userId), avatarUrl: avatarOf(userId), partnerId: userId });
    setShowNewDm(false);
    void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    markRead(conv.id);
  }

  async function send() {
    const body = draft.trim();
    if (!body || !active) return;
    const previousDraft = draft;
    setDraft('');
    setMention(null);
    try {
      await chatApi(apiClient).send(active.id, body);
      await qc.invalidateQueries({ queryKey: ['chat', 'messages', active.id] });
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    } catch {
      // Never lose what the user typed — a failed send puts the draft back so they can retry.
      setDraft(previousDraft);
    }
  }
  async function saveEdit() {
    if (!editing) return;
    const body = editing.body.trim();
    setEditing(null);
    if (!body) return;
    await chatApi(apiClient).edit(editing.id, body);
    await qc.invalidateQueries({ queryKey: ['chat', 'messages', active?.id] });
  }
  async function removeMessage(id: string) {
    await chatApi(apiClient).remove(id);
    await qc.invalidateQueries({ queryKey: ['chat', 'messages', active?.id] });
  }
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !active) return;
    setUploading(true);
    try {
      await chatApi(apiClient).uploadAttachment(active.id, file, draft.trim() || undefined);
      setDraft('');
      await qc.invalidateQueries({ queryKey: ['chat', 'messages', active.id] });
      void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    } finally {
      setUploading(false);
    }
  }
  async function toggleReaction(m: ApiMessage, emoji: string) {
    const mine = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(me?.id ?? '');
    if (mine) await chatApi(apiClient).removeReaction(m.id, emoji);
    else await chatApi(apiClient).addReaction(m.id, emoji);
    await qc.invalidateQueries({ queryKey: ['chat', 'messages', active?.id] });
  }

  const channelUnread = (projectId: string): number =>
    inbox.find((s) => s.conversation.kind === 'PROJECT' && s.conversation.projectId === projectId)?.unread ?? 0;
  const directConversations = inbox.filter((s) => s.conversation.kind === 'DIRECT');
  const dmPartner = (participants: { userId: string }[]): string => {
    const other = participants.find((p) => p.userId !== me?.id)?.userId;
    return other ? nameOf(other) : 'Direct message';
  };
  const dmOptions = directory
    .filter((u) => u.id !== me?.id)
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }));

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Chat"
        subtitle="Talk with your team in project channels or direct messages."
        actions={
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={muted}
            title={muted ? 'Notification sound is off' : 'Notification sound is on'}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              muted ? 'border-line bg-surface text-ink-2 hover:border-brand' : 'border-brand/40 bg-brand/10 text-brand'
            }`}
          >
            {muted ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
            {muted ? 'Sound off' : 'Sound on'}
          </button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Sidebar: channels + DMs */}
        <aside className="card flex h-[76vh] min-h-[520px] flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-2">
            <p className="eyebrow px-2 pb-1 pt-2">Channels</p>
            {projects.length === 0 ? (
              <p className="px-2 py-1 text-xs text-ink-2">No projects yet.</p>
            ) : (
              projects.map((p) => {
                const isActive = active?.kind === 'PROJECT' && active.projectId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => openChannel(p.id, p.name)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${isActive ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-ground'}`}
                  >
                    <span className="grid h-6 w-6 flex-none place-items-center rounded-md text-xs font-bold text-white" style={{ background: p.color }} aria-hidden>#</span>
                    <span className={`min-w-0 flex-1 truncate ${channelUnread(p.id) && !isActive ? 'font-semibold' : ''}`}>{p.name}</span>
                    {channelUnread(p.id) && !isActive ? <Badge tone="brand">{channelUnread(p.id)}</Badge> : null}
                  </button>
                );
              })
            )}

            <div className="mt-3 flex items-center justify-between px-2 pb-1">
              <p className="eyebrow">Direct messages</p>
              <button onClick={() => setShowNewDm((v) => !v)} className="text-xs font-semibold text-brand hover:underline">
                {showNewDm ? 'Cancel' : '+ New'}
              </button>
            </div>
            {showNewDm ? (
              <div className="px-2 pb-2">
                <SearchableSelect ariaLabel="Start a direct message" value="" placeholder="Pick a teammate…" options={dmOptions} onChange={(v) => v && openDirect(v)} />
              </div>
            ) : null}
            {directConversations.length === 0 ? (
              <p className="px-2 py-1 text-xs text-ink-2">No direct messages yet.</p>
            ) : (
              directConversations.map((s) => {
                const isActive = active?.id === s.conversation.id;
                const title = dmPartner(s.participants);
                const otherId = s.participants.find((p) => p.userId !== me?.id)?.userId;
                const otherAvatar = otherId ? avatarOf(otherId) : null;
                const unread = s.unread;
                return (
                  <button
                    key={s.conversation.id}
                    onClick={() => { setActive({ id: s.conversation.id, kind: 'DIRECT', title, avatarUrl: otherAvatar, partnerId: otherId }); markRead(s.conversation.id); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${isActive ? 'bg-brand/10' : 'hover:bg-ground'}`}
                  >
                    <PresenceAvatar name={title} src={otherAvatar} online={isOnline(otherId)} />
                    <span className={`min-w-0 flex-1 truncate ${unread ? 'font-semibold text-ink' : 'text-ink'}`}>{title}</span>
                    {unread ? <Badge tone="brand">{unread}</Badge> : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Thread */}
        <section className="card flex h-[76vh] min-h-[520px] flex-col overflow-hidden">
          {!active ? (
            <EmptyState bare title="Select a conversation" description="Pick a project channel or a direct message to start chatting." />
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-line px-4 py-3">
                {active.kind === 'PROJECT' ? (
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-brand/10 text-sm font-bold text-brand" aria-hidden>#</span>
                ) : (
                  <PresenceAvatar name={active.title} src={active.avatarUrl} online={isOnline(active.partnerId)} />
                )}
                <div className="min-w-0">
                  <h2 className="truncate font-display text-sm font-bold text-ink">{active.title}</h2>
                  {active.kind === 'PROJECT' ? (
                    <p className="text-[11px] text-ink-2">Project channel</p>
                  ) : (
                    <p className={`flex items-center gap-1 text-[11px] ${isOnline(active.partnerId) ? 'text-success' : 'text-ink-2'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${isOnline(active.partnerId) ? 'bg-success' : 'bg-ink-3'}`} aria-hidden />
                      {lastActiveLabel(directory.find((d) => d.id === active.partnerId)?.lastActiveAt ?? null, isOnline(active.partnerId))}
                    </p>
                  )}
                </div>
              </header>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
                {messagesQ.isLoading ? (
                  <div className="flex flex-col gap-4">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className={`flex gap-2.5 ${i % 2 ? 'flex-row-reverse' : ''}`}>
                        <span className="skeleton h-8 w-8 flex-none rounded-full" />
                        <div className={`flex flex-col gap-1.5 ${i % 2 ? 'items-end' : ''}`}>
                          <span className="skeleton h-3 w-24 rounded" />
                          <span className={`skeleton h-9 rounded-2xl ${i % 2 ? 'w-40' : 'w-52'}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <span className="text-4xl">👋</span>
                    <p className="text-sm font-semibold text-ink">No messages yet</p>
                    <p className="text-xs text-ink-2">Say hello to get the conversation started.</p>
                  </div>
                ) : (
                  timeline.map((item) =>
                    item.type === 'day' ? (
                      <DayDivider key={item.id} label={item.label} />
                    ) : (
                      <MessageBubble
                        key={item.m.id}
                        m={item.m}
                        showHeader={item.showHeader}
                        author={nameOf(item.m.userId)}
                        authorAvatar={avatarOf(item.m.userId)}
                        mine={item.m.userId === me?.id}
                        receipt={receiptFor(item.m)}
                        myId={me?.id ?? ''}
                        knownUsernames={knownUsernames}
                        myUsername={me?.username ?? ''}
                        editing={editing?.id === item.m.id ? editing.body : null}
                        onEditChange={(body) => setEditing({ id: item.m.id, body })}
                        onEditStart={() => setEditing({ id: item.m.id, body: item.m.body })}
                        onEditSave={saveEdit}
                        onEditCancel={() => setEditing(null)}
                        onDelete={() => removeMessage(item.m.id)}
                        onReact={(emoji) => toggleReaction(item.m, emoji)}
                      />
                    ),
                  )
                )}
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); void send(); }}
                className="relative flex items-end gap-2 border-t border-line p-3"
              >
                {/* @mention autocomplete */}
                {mention && mentionMatches.length > 0 ? (
                  <div className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-lift">
                    <div className="border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Mention someone</div>
                    <ul>
                      {mentionMatches.map((u, i) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}
                            onMouseEnter={() => setMentionIdx(i)}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === mentionIdx ? 'bg-brand/10' : 'hover:bg-ground'}`}
                          >
                            <Avatar name={`${u.firstName} ${u.lastName}`.trim() || u.username} size="sm" src={u.avatarUrl} />
                            <span className="min-w-0 flex-1 truncate text-ink">{`${u.firstName} ${u.lastName}`.trim() || u.username}</span>
                            <span className="text-xs text-ink-2">@{u.username}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <input ref={fileRef} type="file" hidden onChange={onPickFile} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  title="Attach a file"
                  aria-label="Attach a file"
                  className="grid h-10 w-10 flex-none place-items-center rounded-xl border border-line text-ink-2 transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={onDraftChange}
                  onKeyDown={onComposerKeyDown}
                  rows={1}
                  placeholder={`Message ${active.kind === 'PROJECT' ? '#' + active.title : active.title}…  (@ to mention)`}
                  className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <button type="submit" disabled={!draft.trim()} className="rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand transition-all hover:-translate-y-0.5 disabled:opacity-50">
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  m: ApiMessage;
  showHeader: boolean;
  author: string;
  authorAvatar: string | null;
  mine: boolean;
  myId: string;
  knownUsernames: Set<string>;
  myUsername: string;
  editing: string | null;
  onEditChange: (body: string) => void;
  onEditStart: () => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  receipt?: ReceiptStatus;
}

/** An avatar with a live online/offline presence dot. */
function PresenceAvatar({ name, src, online }: { name: string; src?: string | null; online: boolean }) {
  return (
    <span className="relative inline-flex flex-none">
      <Avatar name={name} size="sm" src={src} />
      <span
        title={online ? 'Online' : 'Offline'}
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${online ? 'bg-success' : 'bg-ink-3'}`}
        aria-hidden
      />
    </span>
  );
}

/** Delivery/read receipt shown on the sender's own messages: ✓ sent · ✓✓ delivered · ✓✓ (blue) seen. */
function ReceiptTick({ status }: { status: ReceiptStatus }) {
  const label = status === 'seen' ? 'Seen' : status === 'delivered' ? 'Delivered' : 'Sent';
  const seen = status === 'seen';
  // Design token instead of a raw palette hue; the bolder stroke on "seen" is a non-colour cue.
  const tone = seen ? 'text-info' : 'text-white/60';
  const Check = ({ className = '' }: { className?: string }) => (
    <svg viewBox="0 0 16 12" width="12" height="9" fill="none" stroke="currentColor" strokeWidth={seen ? 3 : 2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M1 6.5 5 10.5 15 1.5" />
    </svg>
  );
  return (
    <span className={`ml-1 inline-flex translate-y-[1px] items-center align-middle ${tone}`} title={label} aria-label={label} role="img">
      {status === 'sent' ? (
        <Check />
      ) : (
        <span className="relative inline-block" style={{ width: '15px', height: '9px' }}>
          <Check className="absolute left-0 top-0" />
          <Check className="absolute left-[3px] top-0" />
        </span>
      )}
    </span>
  );
}

/** A centered date separator between messages from different days. */
function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="rounded-full border border-line bg-ground px-3 py-0.5 text-[11px] font-semibold text-ink-2">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Render a message body with @mentions highlighted, adapting to the bubble it sits in. */
function renderBody(body: string, knownUsernames: Set<string>, myUsername: string, mine: boolean) {
  return tokenizeMentions(body).map((tok, i) => {
    if (tok.type === 'mention' && tok.username && knownUsernames.has(tok.username)) {
      const isMe = tok.username === myUsername;
      const cls = mine ? 'bg-white/25 text-white' : isMe ? 'bg-brand/15 text-brand' : 'text-brand';
      return (
        <span key={i} className={`rounded px-0.5 font-semibold ${cls}`}>
          {tok.value}
        </span>
      );
    }
    return <span key={i}>{tok.value}</span>;
  });
}

/** One chat message rendered as a bubble; own messages sit on the right in the brand color. */
function MessageBubble({ m, showHeader, author, authorAvatar, mine, myId, knownUsernames, myUsername, editing, onEditChange, onEditStart, onEditSave, onEditCancel, onDelete, onReact, receipt }: MessageBubbleProps) {
  const deleted = !!m.deletedAt;
  const bubble = mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md border border-line bg-ground text-ink';
  return (
    <div className={`group flex gap-2.5 ${mine ? 'flex-row-reverse' : ''} ${showHeader ? 'mt-4' : 'mt-1'}`}>
      {/* Avatar column — shown once per burst for others; own messages need no avatar. */}
      {mine ? null : showHeader ? <Avatar name={author} size="sm" src={authorAvatar} /> : <span className="w-8 flex-none" aria-hidden />}

      <div className={`flex min-w-0 max-w-[82%] flex-col sm:max-w-[68%] ${mine ? 'items-end' : 'items-start'}`}>
        {showHeader ? (
          <div className={`mb-1 flex items-baseline gap-2 px-1 ${mine ? 'flex-row-reverse' : ''}`}>
            <span className="text-xs font-semibold text-ink">{mine ? 'You' : author}</span>
            <span className="text-[11px] text-ink-3">{clockTime(m.createdAt)}</span>
          </div>
        ) : null}

        {deleted ? (
          <div className="rounded-2xl border border-dashed border-line px-3.5 py-2 text-sm italic text-ink-3">This message was deleted.</div>
        ) : editing !== null ? (
          <div className="flex w-full min-w-[15rem] flex-col gap-1">
            <textarea
              value={editing}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave(); } if (e.key === 'Escape') onEditCancel(); }}
              rows={2}
              className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <div className="flex gap-2 text-xs">
              <button onClick={onEditSave} className="font-semibold text-brand hover:underline">Save</button>
              <button onClick={onEditCancel} className="text-ink-2 hover:underline">Cancel</button>
            </div>
          </div>
        ) : (
          <div className={`relative rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-soft ${bubble}`}>
            <span className="whitespace-pre-wrap break-words">{renderBody(m.body, knownUsernames, myUsername, mine)}</span>
            {m.editedAt ? <span className={`ml-1.5 text-[10px] ${mine ? 'text-white/70' : 'text-ink-3'}`}>(edited)</span> : null}
            {mine && receipt ? <ReceiptTick status={receipt} /> : null}

            {/* Floating hover toolbar — sits just outside the bubble on the inner side. */}
            <div
              className={`pointer-events-none absolute top-0 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface px-1 py-0.5 opacity-0 shadow-soft transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 ${mine ? 'right-full mr-2' : 'left-full ml-2'}`}
            >
              {QUICK_REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => onReact(e)} title={`React ${e}`} className="rounded px-1 text-sm hover:bg-ground">{e}</button>
              ))}
              {mine ? (
                <>
                  <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
                  <button type="button" onClick={onEditStart} title="Edit" className="rounded px-1.5 text-xs text-ink-2 hover:bg-ground">Edit</button>
                  <button type="button" onClick={onDelete} title="Delete" className="rounded px-1.5 text-xs text-danger hover:bg-ground">Delete</button>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* Attachments */}
        {!deleted && m.attachments.length > 0 ? (
          <div className={`mt-1.5 flex flex-col gap-1.5 ${mine ? 'items-end' : 'items-start'}`}>
            {m.attachments.map((a) =>
              a.mimeType.startsWith('image/') ? (
                <a key={a.id} href={fileUrl(a.url)} target="_blank" rel="noreferrer" className="block">
                  <img src={fileUrl(a.url)} alt={a.fileName} className="max-h-60 max-w-full rounded-xl border border-line" />
                </a>
              ) : (
                <a
                  key={a.id}
                  href={fileUrl(a.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-brand"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                  <span className="font-medium">{a.fileName}</span>
                  <span className="text-ink-2">{formatSize(a.sizeBytes)}</span>
                </a>
              ),
            )}
          </div>
        ) : null}

        {/* Reaction chips */}
        {!deleted && m.reactions.length > 0 ? (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
            {m.reactions.map((r) => {
              const mineReacted = r.userIds.includes(myId);
              return (
                <button
                  key={r.emoji}
                  onClick={() => onReact(r.emoji)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${mineReacted ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand'}`}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.userIds.length}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
