import { dateTimeText, instantDayText } from '../../lib/day-words';
import { useId, useRef, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import type { MentionPerson } from '../../lib/mentions';
import { useMentionAutocomplete } from '../../hooks/useMentionAutocomplete';
import { MentionList, MentionText } from '../Mentions';
import { ClientEyeIcon } from '../TaskCard';
import { failureMessage } from './save-state';

export interface DrawerComment {
  id: string;
  body: string;
  authorName?: string;
  authorAvatar?: string | null;
  createdAt?: string;
  /** Its text was changed after it was posted. */
  edited?: boolean;
  /** The viewer wrote it: they may change its text. */
  canEdit?: boolean;
  /** The viewer wrote it, or is an admin: they may delete it. */
  canDelete?: boolean;
  /** The comment this one replies to (shown under it). */
  parentId?: string | null;
  /** 1.23: written by a client in the Client portal — marked "Client"; the team may reply to it. */
  fromClient?: boolean;
  /** 1.23: the client's organisation (a client's comment). */
  organisation?: string | null;
  /** 1.23: a reply to a client's comment that the client sees (and was emailed). */
  clientVisible?: boolean;
}

/** Send a reply to a comment; `clientVisible`: the client sees it and gets it by email (a client's comment only). */
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

/**
 * 1.23: a reply to a client's comment. It is for the team unless "Visible to client" is ticked (off to
 * start) — then the client sees it under their comment in the Client portal and gets it by email.
 */
function ReplyBox({ to, people, onSend, onCancel }: { to: string; people: MentionPerson[]; onSend: (body: string, clientVisible: boolean) => Promise<void> | void; onCancel: () => void }) {
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionAutocomplete({ people, value: draft, onChange: setDraft, inputRef: boxRef });
  const hintId = useId();

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setProblem(null);
    try {
      await onSend(body, visible);
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
          data-unsaved={draft.trim() !== '' || undefined}
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
 * One comment. Its author can change the text; the author (or an admin) can delete it, after
 * confirming. Its replies sit under it; a client's comment offers Reply (1.23).
 */
function CommentItem({
  comment: c,
  people,
  onEdit,
  onDelete,
  replies = [],
  onReply,
}: {
  comment: DrawerComment;
  people: MentionPerson[];
  onEdit?: (id: string, body: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
  replies?: DrawerComment[];
  onReply?: ReplyToComment;
}) {
  const [replying, setReplying] = useState(false);
  const canReply = Boolean(c.fromClient && onReply);
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

  const author = c.authorName ?? (c.fromClient ? 'Client' : 'Unknown');
  return (
    <li className="flex gap-2.5">
      <span className="flex-none pt-0.5">
        <Avatar name={author} size="md" src={c.authorAvatar} />
      </span>
      <div className="min-w-0 flex-1">
      {/* A client's comment is tinted, so the team sees at a glance what came from the client. */}
      <div className={`rounded-xl border px-3 py-2 ${c.fromClient ? 'border-info/30 bg-info-soft/40' : 'border-line bg-ground/40'}`}>
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
          {draft === null && (canEdit || canDelete) ? (
            <span className="ms-auto flex items-center gap-0.5 text-xs">
              {confirming ? (
                <>
                  <span className="text-ink-2">Delete?</span>
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
          <div dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-start text-sm leading-relaxed text-ink">
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
      {replies.length > 0 ? (
        <ul aria-label={`Replies to ${author}`} className="mt-2 flex flex-col gap-2 border-s-2 border-line ps-3">
          {replies.map((r) => (
            <CommentItem key={r.id} comment={r} people={people} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
      ) : null}
      {canReply ? (
        replying ? (
          <ReplyBox
            to={author}
            people={people}
            onCancel={() => setReplying(false)}
            onSend={async (body, visible) => {
              await onReply!(c.id, body, visible);
              setReplying(false);
            }}
          />
        ) : (
          <button type="button" onClick={() => setReplying(true)} aria-label={`Reply to ${author}`} className={`mt-1 inline-flex items-center gap-1 ${smallButton}`}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
              <path d="M9 17 4 12l5-5" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
            Reply
          </button>
        )
      ) : null}
      </div>
    </li>
  );
}

/**
 * Comments in threads, oldest first: each top-level comment with every reply under it (a reply to a
 * reply joins its thread). A reply whose comment was deleted stands on its own.
 */
export function commentThreads(comments: DrawerComment[]): { comment: DrawerComment; replies: DrawerComment[] }[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: DrawerComment): DrawerComment => {
    let at = c;
    const seen = new Set<string>([at.id]);
    while (at.parentId && byId.has(at.parentId) && !seen.has(at.parentId)) {
      at = byId.get(at.parentId)!;
      seen.add(at.id);
    }
    return at;
  };
  const threads = new Map<string, { comment: DrawerComment; replies: DrawerComment[] }>();
  for (const c of comments) {
    const root = rootOf(c);
    if (root === c) threads.set(c.id, { comment: c, replies: threads.get(c.id)?.replies ?? [] });
    else {
      const thread = threads.get(root.id) ?? { comment: root, replies: [] };
      thread.replies.push(c);
      threads.set(root.id, thread);
    }
  }
  return [...threads.values()];
}

/** The discussion: comments (oldest first) and a composer with @mention suggestions. */
export function CommentsSection({
  comments,
  people,
  onAdd,
  onEdit,
  onDelete,
  onReply,
}: {
  comments: DrawerComment[];
  people: MentionPerson[];
  onAdd?: (body: string) => Promise<void> | void;
  onEdit?: (id: string, body: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
  /** 1.23: reply to a client's comment (offered on those only). */
  onReply?: ReplyToComment;
}) {
  const threads = commentThreads(comments);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionAutocomplete({ people, value: draft, onChange: setDraft, inputRef: boxRef });

  async function post() {
    const body = draft.trim();
    if (!body || posting || !onAdd) return;
    setPosting(true);
    setProblem(null);
    try {
      await onAdd(body);
      // Keep anything typed while it was posting; clear only what was sent.
      setDraft((d) => (d.trim() === body ? '' : d));
    } catch (err) {
      setProblem(failureMessage(err, 'Couldn’t post the comment.'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <section aria-labelledby="task-comments-heading">
      <h3 id="task-comments-heading" className="eyebrow mb-2">
        Comments{comments.length > 0 ? <span className="ms-1.5 font-normal normal-case tracking-normal text-ink-3">{comments.length}</span> : null}
      </h3>
      {comments.length === 0 ? (
        <p className="text-sm text-ink-3">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {threads.map(({ comment, replies }) => (
            <CommentItem key={comment.id} comment={comment} people={people} onEdit={onEdit} onDelete={onDelete} replies={replies} onReply={onReply} />
          ))}
        </ul>
      )}
      {onAdd ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post();
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
                  void post();
                }
              }}
              placeholder="Write a comment… use @name to mention"
              rows={2}
              className={textBox}
            />
            <MentionList mentions={mentions} emptyText={noOneOnProject} />
          </div>
          {problem ? (
            <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
              {problem}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="hidden text-[11px] text-ink-3 sm:inline">@ to mention · Ctrl+Enter to send</span>
            <button
              type="submit"
              disabled={draft.trim() === '' || posting}
              className="ms-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50 sm:h-8 [@media(pointer:coarse)]:h-11"
            >
              {posting ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
