import { useRef, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import type { MentionPerson } from '../../lib/mentions';
import { useMentionAutocomplete } from '../../hooks/useMentionAutocomplete';
import { MentionList, MentionText } from '../Mentions';
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
}

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
  return new Date(iso).toLocaleDateString();
}

/** Only the task's project members (and admins) can be mentioned in its comments. */
const noOneOnProject = (query: string) => `No one on this project matches “@${query}”.`;
const textBox =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20';

/** One comment. Its author can change the text; the author (or an admin) can delete it, after confirming. */
function CommentItem({
  comment: c,
  people,
  onEdit,
  onDelete,
}: {
  comment: DrawerComment;
  people: MentionPerson[];
  onEdit?: (id: string, body: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
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

  const author = c.authorName ?? 'Unknown';
  return (
    <li className="flex gap-2.5">
      <span className="flex-none pt-0.5">
        <Avatar name={author} size="md" src={c.authorAvatar} />
      </span>
      <div className="min-w-0 flex-1 rounded-xl border border-line bg-ground/40 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span dir="auto" className="text-sm font-semibold text-ink">
            {author}
          </span>
          {c.createdAt ? (
            <time dateTime={c.createdAt} className="text-xs text-ink-3" title={new Date(c.createdAt).toLocaleString()}>
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
              <textarea ref={draftRef} dir="auto" aria-label="Edit comment" autoFocus value={draft} {...draftMentions.inputProps} rows={2} className={textBox} />
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
    </li>
  );
}

/** The discussion: comments (oldest first) and a composer with @mention suggestions. */
export function CommentsSection({
  comments,
  people,
  onAdd,
  onEdit,
  onDelete,
}: {
  comments: DrawerComment[];
  people: MentionPerson[];
  onAdd?: (body: string) => Promise<void> | void;
  onEdit?: (id: string, body: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
}) {
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
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} people={people} onEdit={onEdit} onDelete={onDelete} />
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
