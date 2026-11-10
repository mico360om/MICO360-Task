import { dateTimeText, instantDayText } from '../../lib/day-words';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import type { MentionPerson } from '../../lib/mentions';
import { useMentionAutocomplete } from '../../hooks/useMentionAutocomplete';
import { MentionList, MentionText } from '../Mentions';
import { ClientEyeIcon } from '../TaskCard';
import { failureMessage } from './save-state';
import { COMMENTS_PAGE, newestFirst, scrolledPast, scrollToListTop, type PendingComment } from '../../lib/comment-feed';
import { NewCommentsButton } from '../comments/NewCommentsButton';
import { useCommentArrivals } from '../../hooks/useCommentArrivals';
import { usePendingComments } from '../../hooks/usePendingComments';

export interface DrawerComment {
  id: string;
  body: string;
  authorName?: string;
  /** Comments, newest first: the author's username, so a reply to their reply starts "@username". */
  authorUsername?: string | null;
  authorAvatar?: string | null;
  createdAt?: string;
  /** Its text was changed after it was posted. */
  edited?: boolean;
  /** The viewer wrote it (never held back or highlighted as new; a comment being sent meets it here). */
  mine?: boolean;
  /** The viewer wrote it: they may change its text. */
  canEdit?: boolean;
  /** The viewer wrote it, or is an admin: they may delete it. */
  canDelete?: boolean;
  /** The comment this one replies to (shown under it). */
  parentId?: string | null;
  /** 1.23: written by a client in the Client portal — marked "Client". */
  fromClient?: boolean;
  /** 1.23: the client's organisation (a client's comment). */
  organisation?: string | null;
  /** 1.23: a reply to a client's comment that the client sees (and was emailed). */
  clientVisible?: boolean;
  /** 1.23.1: it came with a task merged into this one ("from MICO-14"). */
  fromKey?: string | null;
}

/**
 * Send a reply. `parentId` is the comment answered (a reply's id when answering a reply: the server files it in the
 * thread); `clientVisible`: the client sees it and gets it by email (in a client's thread only).
 */
export type ReplyToComment = (parentId: string, body: string, clientVisible: boolean) => Promise<void> | void;

/** "3m ago", "2h ago", "5d ago" for recent, else a short date. The full time goes in a tooltip. */
export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return instantDayText(iso);
}

/** Only the task's project members (and admins) can be mentioned in its comments. */
const noOneOnProject = (query: string) => `No one on this project matches “@${query}”.`;
const textBox =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20';

/** A small text button under a comment ("Reply"); 44px tall on a touch screen. */
const smallButton = 'h-8 rounded px-2 text-xs font-medium text-ink-2 hover:bg-ground hover:text-ink sm:h-7 [@media(pointer:coarse)]:h-11';

/** A comment that just arrived (or was just brought in) is highlighted for a few seconds; no fade with reduced motion. */
const freshRing = 'ring-2 ring-brand/40 ring-offset-1 ring-offset-surface';

const ReplyIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
    <path d="M9 17 4 12l5-5" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </svg>
);

/**
 * A reply in a thread. In a client's thread it is for the team unless "Visible to client" is ticked (off to start) —
 * then the client sees it under their comment in the Client portal and gets it by email.
 */
function ReplyBox({
  to,
  people,
  initial = '',
  offerClientTick,
  onSend,
  onCancel,
}: {
  to: string;
  people: MentionPerson[];
  /** "@sara " when answering a reply. */
  initial?: string;
  offerClientTick: boolean;
  onSend: (body: string, clientVisible: boolean) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionAutocomplete({ people, value: draft, onChange: setDraft, inputRef: boxRef });
  const hintId = useId();
  // The cursor after "@name " when answering a reply.
  useEffect(() => {
    const el = boxRef.current;
    if (el && initial) el.setSelectionRange(initial.length, initial.length);
  }, [initial]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setProblem(null);
    try {
      await onSend(body, offerClientTick && visible);
    } catch (err) {
      setProblem(failureMessage(err, 'Couldn’t send the reply.'));
      setSending(false);
    }
  }

  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="relative">
        <textarea
          ref={boxRef}
          dir="auto"
          aria-label={`Reply to ${to}`}
          autoFocus
          value={draft}
          data-unsaved={draft.trim() !== '' && draft !== initial ? true : undefined}
          {...mentions.inputProps}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Write a reply…"
          rows={2}
          className={textBox}
        />
        <MentionList mentions={mentions} emptyText={noOneOnProject} />
      </div>
      {offerClientTick ? (
        <div>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink [@media(pointer:coarse)]:min-h-11">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
              aria-describedby={hintId}
              className="h-4 w-4 flex-none accent-[rgb(var(--c-brand))]"
            />
            Visible to client
          </label>
          <p id={hintId} className="ps-7 text-xs text-ink-2">
            The client sees this reply and gets it by email.
          </p>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
          {problem}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2 text-xs">
        <button type="button" onClick={onCancel} aria-label="Cancel reply" className="h-8 rounded-lg px-2.5 text-ink-2 hover:bg-ground [@media(pointer:coarse)]:h-11">
          Cancel
        </button>
        <button type="submit" disabled={!draft.trim() || sending} className="h-8 rounded-lg bg-brand px-3 font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50 [@media(pointer:coarse)]:h-11">
          {sending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  );
}

/**
 * One comment. Its author can change the text; the author (or an admin) can delete it, after confirming. Every
 * comment offers Reply (owner, 10 Nov) when replies can be sent.
 */
function CommentItem({
  comment: c,
  people,
  onEdit,
  onDelete,
  onReply,
  fresh = false,
  hasReplies = false,
}: {
  comment: DrawerComment;
  people: MentionPerson[];
  onEdit?: (id: string, body: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
  /** Start a reply to this comment. */
  onReply?: () => void;
  fresh?: boolean;
  hasReplies?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const draftMentions = useMentionAutocomplete({ people, value: draft ?? '', onChange: setDraft, inputRef: draftRef });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const canEdit = Boolean(c.canEdit && onEdit);
  const canDelete = Boolean(c.canDelete && onDelete);

  async function save() {
    const body = (draft ?? '').trim();
    if (!body || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      await onEdit?.(c.id, body);
      setDraft(null);
    } catch (err) {
      setProblem(failureMessage(err, 'Couldn’t save the comment. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  const author = authorOf(c);
  return (
    <div className="flex gap-2.5" data-fresh={fresh || undefined}>
      <span className="flex-none pt-0.5">
        <Avatar name={author} size="md" src={c.authorAvatar} />
      </span>
      <div className="min-w-0 flex-1">
        {/* A client's comment is tinted, so the team sees at a glance what came from the client. */}
        <div
          className={`rounded-xl border px-3 py-2 motion-safe:transition-shadow motion-safe:duration-700 ${c.fromClient ? 'border-info/30 bg-info-soft/40' : 'border-line bg-ground/40'} ${fresh ? freshRing : ''}`}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span dir="auto" className="text-sm font-semibold text-ink">
              {author}
            </span>
            {c.fromClient ? (
              <>
                <span className="self-center" title={c.organisation ? `A client, from ${c.organisation}` : 'A client, in the Client portal'}>
                  <Badge tone="info">Client</Badge>
                </span>
                {c.organisation ? (
                  <span dir="auto" className="text-xs text-ink-2">
                    {c.organisation}
                  </span>
                ) : null}
              </>
            ) : null}
            {c.clientVisible ? (
              <span className="inline-flex items-center gap-1 self-center rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info" title="The client sees this reply in the Client portal">
                <ClientEyeIcon size={11} />
                Visible to client
              </span>
            ) : null}
            {c.createdAt ? (
              <time dateTime={c.createdAt} className="text-xs text-ink-3" title={dateTimeText(c.createdAt)}>
                {relativeTime(c.createdAt)}
              </time>
            ) : null}
            {c.edited ? <span className="text-xs text-ink-3">(edited)</span> : null}
            {c.fromKey ? (
              <span className="text-xs text-ink-3" title={`Written on ${c.fromKey}, merged into this task`}>
                from <span dir="ltr" translate="no" className="font-mono">{c.fromKey}</span>
              </span>
            ) : null}
            {draft === null && (canEdit || canDelete) ? (
              <span className="ms-auto flex items-center gap-0.5 text-xs">
                {confirming ? (
                  <>
                    <span className="text-ink-2">{hasReplies ? 'Delete? Its replies stay.' : 'Delete?'}</span>
                    <button type="button" onClick={() => { setConfirming(false); onDelete?.(c.id); }} className="h-8 rounded px-2 font-semibold text-danger hover:bg-danger-soft sm:h-7 [@media(pointer:coarse)]:h-11">
                      Yes, delete
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="h-8 rounded px-2 text-ink-2 hover:bg-ground sm:h-7 [@media(pointer:coarse)]:h-11">
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    {canEdit ? (
                      <button type="button" onClick={() => { setProblem(null); setDraft(c.body); }} aria-label="Edit your comment" className="h-8 rounded px-2 text-ink-2 hover:bg-ground hover:text-ink sm:h-7 [@media(pointer:coarse)]:h-11">
                        Edit
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        aria-label={c.canEdit ? 'Delete your comment' : `Delete comment by ${author}`}
                        className="h-8 rounded px-2 text-ink-2 hover:bg-ground hover:text-danger sm:h-7 [@media(pointer:coarse)]:h-11"
                      >
                        Delete
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            ) : null}
          </div>
          {draft === null ? (
            <div dir="auto" data-comment-body className="mt-0.5 whitespace-pre-wrap break-words text-start text-sm leading-relaxed text-ink">
              <MentionText body={c.body} people={people} />
            </div>
          ) : (
            <div className="mt-1.5 flex flex-col gap-2">
              <div className="relative">
                <textarea ref={draftRef} dir="auto" aria-label="Edit comment" autoFocus value={draft} data-unsaved={draft.trim() !== c.body.trim() || undefined} {...draftMentions.inputProps} rows={2} className={textBox} />
                <MentionList mentions={draftMentions} emptyText={noOneOnProject} />
              </div>
              {problem ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {problem}
                </p>
              ) : null}
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => void save()} disabled={!draft.trim() || saving} aria-label="Save comment" className="h-8 rounded-lg bg-brand px-3 font-semibold text-white disabled:opacity-50 [@media(pointer:coarse)]:h-11">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => { setDraft(null); setProblem(null); }} className="h-8 rounded-lg px-2.5 text-ink-2 hover:bg-ground [@media(pointer:coarse)]:h-11">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {onReply ? (
          <button type="button" onClick={onReply} aria-label={`Reply to ${author}`} className={`mt-1 inline-flex items-center gap-1 ${smallButton}`}>
            <ReplyIcon />
            Reply
          </button>
        ) : null}
      </div>
    </div>
  );
}

const authorOf = (c: DrawerComment) => c.authorName ?? (c.fromClient ? 'Client' : 'Unknown');

export interface CommentThread {
  comment: DrawerComment;
  replies: DrawerComment[];
  /** The comment was deleted while replies remain: shown as "Comment deleted" (owner, 10 Nov). */
  deleted?: boolean;
}

/**
 * Comments in threads (in the order given — the server's, oldest first): each top-level comment with every reply
 * under it (a reply to a reply joins its thread). Replies whose comment was deleted keep their thread under a "Comment
 * deleted" stand-in, dated by its first reply.
 */
export function commentThreads(comments: DrawerComment[]): CommentThread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: DrawerComment): string => {
    let at = c;
    const seen = new Set<string>([at.id]);
    while (at.parentId && !seen.has(at.parentId)) {
      const up = byId.get(at.parentId);
      if (!up) return at.parentId; // its comment is gone: the thread is the deleted one's
      at = up;
      seen.add(at.id);
    }
    return at.id;
  };
  const threads = new Map<string, CommentThread>();
  for (const c of comments) {
    const rootId = rootOf(c);
    if (rootId === c.id) threads.set(c.id, { comment: c, replies: threads.get(c.id)?.replies ?? [] });
    else {
      const root = byId.get(rootId);
      const thread: CommentThread = threads.get(rootId) ?? (root ? { comment: root, replies: [] } : { comment: { id: rootId, body: '', createdAt: c.createdAt }, replies: [], deleted: true });
      thread.replies.push(c);
      threads.set(rootId, thread);
    }
  }
  // Replies oldest first (reads as a conversation), whatever order they came in.
  const at = (c: DrawerComment) => (c.createdAt ? Date.parse(c.createdAt) : 0) || 0;
  for (const t of threads.values()) t.replies = t.replies.map((r, i) => ({ r, i })).sort((x, y) => at(x.r) - at(y.r) || x.i - y.i).map((x) => x.r);
  return [...threads.values()];
}

/** My comment on its way (at the top at once), or one that didn't go: "Not sent", with Try again and Edit. */
function PendingItem({ pending: p, me, onRetry, onEdit }: { pending: PendingComment; me?: { name: string; avatarUrl?: string | null }; onRetry: () => void; onEdit: () => void }) {
  const failed = p.status === 'failed';
  const name = me?.name || 'You';
  return (
    <li className="flex gap-2.5" data-unsaved={p.status !== 'sent' || undefined} data-pending={p.status}>
      <span className="flex-none pt-0.5">
        <Avatar name={name} size="md" src={me?.avatarUrl ?? null} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`rounded-xl border px-3 py-2 ${failed ? 'border-danger/40 bg-danger-soft/30' : 'border-line bg-ground/40'}`}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span dir="auto" className="text-sm font-semibold text-ink">
              {name}
            </span>
            {p.status === 'sending' ? <span className="text-xs text-ink-3">Sending…</span> : p.status === 'sent' ? <span className="text-xs text-ink-3">just now</span> : null}
          </div>
          <div dir="auto" data-comment-body className={`mt-0.5 whitespace-pre-wrap break-words text-start text-sm leading-relaxed ${p.status === 'sending' ? 'text-ink-2' : 'text-ink'}`}>
            {p.body}
          </div>
        </div>
        {failed ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p role="alert" className="text-xs font-medium text-danger">
              Not sent — {p.error}
            </p>
            <button type="button" onClick={onRetry} className={`${smallButton} font-semibold text-brand`}>
              Try again
            </button>
            <button type="button" onClick={onEdit} aria-label="Edit the comment that wasn’t sent" className={smallButton}>
              Edit
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** One thread: the comment (or "Comment deleted"), its replies oldest first, and the reply box when answering. */
function ThreadItem({
  thread,
  people,
  onEdit,
  onDelete,
  onReply,
  fresh,
  newReply,
}: {
  thread: CommentThread;
  people: MentionPerson[];
  onEdit?: (id: string, body: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
  onReply?: ReplyToComment;
  fresh: Set<string>;
  newReply: boolean;
}) {
  const { comment: root, replies, deleted } = thread;
  const [answering, setAnswering] = useState<DrawerComment | null>(null);
  const rootAuthor = deleted ? 'a deleted comment' : authorOf(root);
  const startReply = (c: DrawerComment) => (onReply ? () => setAnswering(c) : undefined);
  // Answering a reply starts "@username " (not my own, not a client's — clients can't be mentioned). Never in a
  // client's thread: a reply there may be shown to the client, who never sees a team member's name (review).
  const inClientThread = !deleted && root.fromClient === true;
  const initial = answering && answering.id !== root.id && answering.authorUsername && !answering.mine && !inClientThread ? `@${answering.authorUsername} ` : '';
  return (
    <li className="flex flex-col">
      {deleted ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm italic text-ink-3">Comment deleted</p>
      ) : (
        <CommentItem comment={root} people={people} onEdit={onEdit} onDelete={onDelete} onReply={startReply(root)} fresh={fresh.has(root.id)} hasReplies={replies.length > 0} />
      )}
      {newReply ? (
        <span className="ms-11 mt-1 self-start rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">New reply</span>
      ) : null}
      {replies.length > 0 || answering ? (
        <div className="ms-5 mt-2 border-s-2 border-line ps-3 sm:ms-11">
          {replies.length > 0 ? (
            <ul aria-label={`Replies to ${rootAuthor}`} className="flex flex-col gap-2">
              {replies.map((r) => (
                <li key={r.id}>
                  <CommentItem comment={r} people={people} onEdit={onEdit} onDelete={onDelete} onReply={startReply(r)} fresh={fresh.has(r.id)} />
                </li>
              ))}
            </ul>
          ) : null}
          {answering && onReply ? (
            <ReplyBox
              key={answering.id}
              to={authorOf(answering)}
              people={people}
              initial={initial}
              offerClientTick={!deleted && root.fromClient === true}
              onCancel={() => setAnswering(null)}
              onSend={async (body, visible) => {
                await onReply(answering.id, body, visible);
                setAnswering(null);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The discussion (owner, 10 Nov 2026): the write box (with @mention suggestions) on top, staying in view while the
 * comments scroll; the newest comment first, 30 at a time; my comment shows at once as I send it; others' arrive live
 * — or, while I read further down, wait behind a "N new comments ↑" button. Every comment offers Reply; replies sit
 * under their comment, oldest first.
 */
export function CommentsSection({
  comments,
  loaded = true,
  people,
  me,
  onAdd,
  onEdit,
  onDelete,
  onReply,
}: {
  /** The server's comments (any order; replies too). */
  comments: DrawerComment[];
  /** The comments have loaded (until then an empty list isn't "no comments"). */
  loaded?: boolean;
  people: MentionPerson[];
  /** Who I am, for my comment while it is on its way. */
  me?: { name: string; avatarUrl?: string | null };
  /** Send a comment; resolves with the saved comment's id (when known). */
  onAdd?: (body: string) => Promise<unknown> | void;
  onEdit?: (id: string, body: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
  onReply?: ReplyToComment;
}) {
  const [draft, setDraft] = useState('');
  const [limit, setLimit] = useState(COMMENTS_PAGE);
  const sectionRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionAutocomplete({ people, value: draft, onChange: setDraft, inputRef: boxRef });

  const isMine = (c: DrawerComment) => c.mine ?? c.canEdit ?? false;
  const byId = new Map(comments.map((c) => [c.id, c]));
  const arrivals = useCommentArrivals({
    ids: comments.map((c) => c.id),
    ready: loaded,
    mine: (id) => Boolean(byId.get(id) && isMine(byId.get(id)!)),
    parentOf: (id) => byId.get(id)?.parentId,
    isAway: () => scrolledPast(topRef.current, formRef.current),
    nameOf: (id) => byId.get(id)?.authorName,
  });
  const sending = usePendingComments(
    comments.map((c) => ({ id: c.id, mine: isMine(c), body: c.body })),
    'Check your connection and try again.',
  );

  const shown = comments.filter((c) => !arrivals.held.has(c.id) && !(c.parentId && arrivals.held.has(c.parentId)));
  const threads = newestFirst(commentThreads(shown), (c) => c.createdAt);
  // What arrived since opening adds to what shows, so nothing being read drops off the end.
  const grown = threads.filter((t) => arrivals.arrived.has(t.comment.id)).length;
  const visible = threads.slice(0, limit + grown);
  const older = threads.length - visible.length;

  const send = useCallback((body: string) => onAdd?.(body) ?? Promise.resolve(), [onAdd]);
  function post() {
    const body = draft.trim();
    if (!body || !onAdd) return;
    setDraft('');
    sending.send(body, send);
  }
  function takeBack(p: PendingComment) {
    sending.drop(p.key);
    setDraft((d) => (d.trim() ? `${d}\n${p.body}` : p.body));
    boxRef.current?.focus();
  }
  function showNew() {
    arrivals.reveal();
    scrollToListTop(sectionRef.current);
    listRef.current?.focus({ preventScroll: true });
  }

  const count = shown.length;
  const empty = visible.length === 0 && sending.pending.length === 0;
  return (
    <section ref={sectionRef} aria-labelledby="task-comments-heading">
      <h3 id="task-comments-heading" className="eyebrow mb-2">
        Comments{count > 0 ? <span className="ms-1.5 font-normal normal-case tracking-normal text-ink-3">{count}</span> : null}
      </h3>
      {/* The write box stays in view at the top while the comments under it scroll. */}
      <div ref={formRef} data-comments-box={onAdd ? true : undefined} className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-3">
        {onAdd ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              post();
            }}
          >
            <div className="relative">
              <textarea
                ref={boxRef}
                dir="auto"
                aria-label="Add a comment"
                value={draft}
                data-unsaved={draft.trim() !== '' || undefined}
                {...mentions.inputProps}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    post();
                  }
                }}
                placeholder="Write a comment… use @name to mention"
                rows={2}
                className={textBox}
              />
              <MentionList mentions={mentions} emptyText={noOneOnProject} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="hidden text-[11px] text-ink-3 sm:inline">@ to mention · Ctrl+Enter to send</span>
              <button
                type="submit"
                disabled={draft.trim() === ''}
                className="ms-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50 sm:h-8 [@media(pointer:coarse)]:h-11"
              >
                Comment
              </button>
            </div>
          </form>
        ) : null}
        {arrivals.held.size > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 top-full z-10 mt-1 flex justify-center">
            <NewCommentsButton count={arrivals.held.size} onClick={showNew} />
          </div>
        ) : null}
      </div>
      <div ref={topRef} data-comments-top aria-hidden="true" />
      <p aria-live="polite" className="sr-only">
        {arrivals.announcement}
      </p>
      {empty ? (
        <p className="text-sm text-ink-3">No comments yet. Start the conversation.</p>
      ) : (
        <ul ref={listRef} tabIndex={-1} aria-label="Comments, newest first" className="flex flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
          {sending.pending.map((p) => (
            <PendingItem key={p.key} pending={p} me={me} onRetry={() => sending.retry(p.key, send)} onEdit={() => takeBack(p)} />
          ))}
          {visible.map((t) => (
            <ThreadItem
              key={t.comment.id}
              thread={t}
              people={people}
              onEdit={onEdit}
              onDelete={onDelete}
              onReply={onReply}
              fresh={arrivals.fresh}
              newReply={t.replies.some((r) => arrivals.arrived.has(r.id) && !isMine(r))}
            />
          ))}
        </ul>
      )}
      {older > 0 ? (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => setLimit((n) => n + COMMENTS_PAGE)} className="h-9 rounded-lg border border-line px-3 text-xs font-semibold text-ink-2 hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11">
            Show older comments
          </button>
        </div>
      ) : null}
    </section>
  );
}
