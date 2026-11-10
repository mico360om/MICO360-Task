import { useCallback, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isNotShared, portalProblem, type PortalComment, type PortalFile, type PortalTaskView } from '../../api/portal';
import { Button, buttonClass } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PortalSendBackDialog } from '../../components/portal/PortalSendBackDialog';
import { usePortalApi, usePreviewOff } from '../../components/portal/portal-context';
import { taskChanged, usePortalTask } from '../../components/portal/portal-queries';
import { BackLink, Chip, day, KeyChip, LoadFailed, Loading, NotShared, OWN_LINES, ProgressBar, Section, sizeWords, StatusBadge, TOUCH, usePortalPageName } from '../../components/portal/portal-ui';
import { ApiError } from '../../lib/api-client';
import { dateTimeText, instantDayText } from '../../lib/day-words';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { NeedsModule, usePortalProjectContext } from './PortalProjectLayout';
import { COMMENTS_PAGE, newestFirst, scrolledPast, scrollToListTop, type PendingComment } from '../../lib/comment-feed';
import { useCommentArrivals } from '../../hooks/useCommentArrivals';
import { usePendingComments } from '../../hooks/usePendingComments';
import { NewCommentsButton } from '../../components/task-drawer/comments';

/** The longest comment the server keeps. */
const COMMENT_MAX = 10_000;
/** The largest file the server takes (as for the team's own uploads), said up front and checked before sending. */
const UPLOAD_MAX_MB = 10;

/**
 * 1.23 One shared task in the Client portal: its status, due day and (when shared) description;
 * with the Comment action their comments and the team's replies marked "Visible to client" (as
 * "Project team", never a name); with Sign off, Accept or Send back once it is finished. 1.23.7: its
 * files (shared by the team, or their own uploads) and, with Upload, "Upload a document".
 */
export function PortalTaskPage() {
  return (
    <NeedsModule module="progress">
      <TaskPage />
    </NeedsModule>
  );
}

function TaskPage() {
  const { projectId, view: project } = usePortalProjectContext();
  const { taskId = '' } = useParams();
  const q = usePortalTask(projectId, taskId);
  usePortalPageName(q.data ? `${q.data.task.key} ${q.data.task.title}` : null);
  const back = `/portal/projects/${encodeURIComponent(projectId)}/progress`;

  return (
    <div className="flex flex-col gap-4">
      <BackLink to={back}>Progress &amp; tasks</BackLink>
      {/* The task is read again every few seconds: a blip while it is on screen keeps what shows; no longer shared says so. */}
      {q.isError && (isNotShared(q.error) || !q.data) ? (
        isNotShared(q.error) ? <NotShared backTo={back} backLabel="Back to the tasks" /> : <LoadFailed what="the task" onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <TaskBody projectId={projectId} taskId={taskId} view={q.data} timeZone={project.timeZone} />
      ) : (
        <Loading what="the task" />
      )}
    </div>
  );
}

function TaskBody({ projectId, taskId, view, timeZone }: { projectId: string; taskId: string; view: PortalTaskView; timeZone: string }) {
  const { task, comments, can } = view;
  const qc = useQueryClient();
  const api = usePortalApi();
  const off = usePreviewOff();
  const [confirming, setConfirming] = useState<'accept' | 'sendBack' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => api.accept(projectId, taskId),
    onSuccess: (fresh) => {
      taskChanged(qc, projectId, taskId, fresh);
      setConfirming(null);
      setNotice('Thank you. The project team can see that you accepted this task.');
    },
    onError: (err) => setProblem(portalProblem(err, 'Couldn’t accept the task.')),
  });
  const sendBack = useMutation({
    mutationFn: (reason: string) => api.sendBack(projectId, taskId, reason),
    onSuccess: (fresh) => {
      taskChanged(qc, projectId, taskId, fresh);
      setConfirming(null);
      setNotice('Sent back. The task is in progress again, and the project team has your reason.');
    },
    onError: (err) => setProblem(portalProblem(err, 'Couldn’t send the task back.')),
  });
  const open = (which: 'accept' | 'sendBack') => {
    setProblem(null);
    setNotice(null);
    setConfirming(which);
  };

  return (
    <>
      <article aria-labelledby="portal-task-title" className="rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <KeyChip value={task.key} />
          <StatusBadge label={task.status} />
          {task.late ? <Chip tone="danger">Late</Chip> : null}
          {task.acceptedOn ? <Chip tone="success">Accepted {day(task.acceptedOn)}</Chip> : null}
        </div>
        <h2 id="portal-task-title" dir="auto" className="mt-2 break-words font-display text-xl font-bold text-ink sm:text-2xl">{task.title}</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-2">Due</dt>
            <dd className="font-semibold text-ink">{task.dueDate ? day(task.dueDate) : 'No due date'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Status</dt>
            <dd className="font-semibold text-ink">{task.status}</dd>
          </div>
        </dl>
        {task.description ? (
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Description</h3>
            <p className={`mt-1 max-w-[75ch] whitespace-pre-line break-words text-sm text-ink ${OWN_LINES}`}>{task.description}</p>
          </div>
        ) : null}
      </article>

      {notice ? <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{notice}</p> : null}

      {can.signOff ? (
        <Section title="Sign off">
          <p className="text-sm text-ink-2">The team has finished this task. Is it done the way you need it?</p>
          {problem && !confirming ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button type="button" className={`${TOUCH} ${off.className}`} disabled={off.disabled} title={off.title} onClick={() => open('accept')}>
              Accept
            </Button>
            <Button type="button" variant="secondary" className={`${TOUCH} ${off.className}`} disabled={off.disabled} title={off.title} onClick={() => open('sendBack')}>
              Send back
            </Button>
          </div>
        </Section>
      ) : task.acceptedOn ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">You accepted this task on {day(task.acceptedOn)}.</p>
      ) : null}

      <Files projectId={projectId} taskId={taskId} files={view.files ?? []} canUpload={Boolean(can.upload)} timeZone={timeZone} />

      {comments ? <Comments projectId={projectId} taskId={taskId} comments={comments} canComment={can.comment} timeZone={timeZone} /> : null}

      {confirming === 'accept' && !off.disabled ? (
        <ConfirmDialog
          title={`Accept ${task.key}?`}
          tone="primary"
          confirmLabel="Accept"
          keepLabel="Not yet"
          busy={accept.isPending}
          error={problem}
          onConfirm={() => {
            setProblem(null);
            accept.mutate();
          }}
          onClose={() => setConfirming(null)}
        >
          You confirm <bdi className="font-medium text-ink">{task.title}</bdi> is done. The project team will see that you accepted it.
        </ConfirmDialog>
      ) : null}
      {confirming === 'sendBack' && !off.disabled ? (
        <PortalSendBackDialog
          taskKey={task.key}
          taskTitle={task.title}
          busy={sendBack.isPending}
          error={problem}
          onSend={(reason) => {
            setProblem(null);
            sendBack.mutate(reason);
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}

/**
 * 1.23.7 The task's files: those the project team shows the client and the client's own uploads, each with
 * Download (View tasks is enough); with Upload, "Upload a document" — the team sees it, other clients of the
 * project only if the team shares it. No section at all with no files and nothing to upload.
 */
function Files({ projectId, taskId, files, canUpload, timeZone }: { projectId: string; taskId: string; files: PortalFile[]; canUpload: boolean; timeZone: string }) {
  const id = useId();
  const qc = useQueryClient();
  const api = usePortalApi();
  const off = usePreviewOff();
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [downloadProblem, setDownloadProblem] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.upload(projectId, taskId, file, setProgress),
    onMutate: () => setProgress(0),
    onSuccess: (fresh, file) => {
      taskChanged(qc, projectId, taskId, fresh);
      setDone(`Uploaded ${file.name}. The project team can see it.`);
    },
    onError: (err) =>
      setProblem(err instanceof ApiError && err.status === 429 ? 'Too many uploads at once. Wait a minute and try again.' : portalProblem(err, 'Couldn’t upload the document.')),
    onSettled: () => setProgress(null),
  });

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // The same file can be picked again (after a refusal).
    e.target.value = '';
    if (!file) return;
    setDone(null);
    setProblem(null);
    if (file.size > UPLOAD_MAX_MB * 1024 * 1024) return setProblem(`${file.name} is bigger than ${UPLOAD_MAX_MB} MB. Choose a smaller file.`);
    upload.mutate(file);
  };

  const download = async (f: PortalFile) => {
    setFetching(f.id);
    setDownloadProblem(null);
    try {
      const blob = await api.file(projectId, taskId, f.id);
      downloadBlob(fileNameOf(blob) ?? f.name, blob);
    } catch (err) {
      setDownloadProblem(portalProblem(err, 'Couldn’t download the file.'));
    } finally {
      setFetching(null);
    }
  };

  if (files.length === 0 && !canUpload) return null;
  const sending = upload.isPending ? upload.variables : null;
  const locked = off.disabled || upload.isPending;

  return (
    <Section title="Files">
      {downloadProblem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{downloadProblem}</p> : null}
      {files.length === 0 ? (
        <p className="text-sm text-ink-2">No documents yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span aria-hidden="true" className={`mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl ${f.from === 'you' ? 'bg-brand/10 text-brand' : 'bg-ground text-ink-2'}`}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
                  <bdi>{f.name}</bdi>
                </p>
                <p className="mt-0.5 text-xs text-ink-2">
                  {sizeWords(f.sizeBytes)} · {instantDayText(f.addedAt, timeZone)} · {f.from === 'you' ? 'Uploaded by you' : 'Shared by the project team'}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={`${TOUCH} flex-none ${off.className}`}
                disabled={off.disabled}
                title={off.title}
                loading={fetching === f.id}
                aria-label={`Download ${f.name}`}
                onClick={() => void download(f)}
              >
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
      {canUpload ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          <div>
            {/* A button-like label around the file box: the box itself is for the keyboard and screen readers. */}
            <label
              title={off.title}
              className={buttonClass('secondary', 'md', `${TOUCH} focus-within:ring-2 focus-within:ring-brand/40 ${locked ? 'cursor-not-allowed opacity-60 hover:translate-y-0' : 'cursor-pointer'}`)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m17 8-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
              Upload a document
              <input type="file" className="sr-only" disabled={locked} aria-describedby={`${id}-hint`} onChange={choose} />
            </label>
          </div>
          <p id={`${id}-hint`} className="text-xs text-ink-2">
            One file at a time, up to {UPLOAD_MAX_MB} MB. The project team sees what you upload. Other clients on this project see it only if the team shares it with them.
          </p>
          {sending && progress !== null ? (
            <div role="status" className="flex flex-col gap-1.5">
              <p className="text-sm text-ink">
                Uploading <bdi>{sending.name}</bdi>… {Math.round(progress * 100)}%
              </p>
              <ProgressBar percent={progress * 100} label={`Uploading ${sending.name}`} />
            </div>
          ) : null}
          {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
          {done ? <p role="status" className="text-sm text-success">{done}</p> : null}
        </div>
      ) : null}
    </Section>
  );
}

/**
 * Their comments in threads, newest first: each of their comments with the replies in it (the team's marked "Visible to
 * client", and — owner, 10 Nov 2026 — their own) under it, oldest first. Replies whose comment was deleted keep their
 * thread under "Comment deleted". (The server sends only what they may see.)
 */
function threads(comments: PortalComment[]): { comment: PortalComment; replies: PortalComment[]; deleted?: boolean }[] {
  const tops = comments.filter((c) => !c.replyTo);
  const ids = new Set(tops.map((c) => c.id));
  const orphans = new Map<string, PortalComment[]>();
  for (const c of comments) if (c.replyTo && !ids.has(c.replyTo)) orphans.set(c.replyTo, [...(orphans.get(c.replyTo) ?? []), c]);
  const at = (c: PortalComment) => Date.parse(c.createdAt) || 0;
  const oldestFirst = (list: PortalComment[]) => [...list].sort((a, b) => at(a) - at(b));
  return [
    ...tops.map((c) => ({ comment: c, replies: oldestFirst(comments.filter((r) => r.replyTo === c.id)) })),
    ...[...orphans.entries()].map(([id, replies]) => {
      const sorted = oldestFirst(replies);
      return { comment: { id, from: 'team' as const, replyTo: null, body: '', createdAt: sorted[0]!.createdAt, edited: false }, replies: sorted, deleted: true };
    }),
  ];
}

const whoOf = (c: PortalComment) => (c.from === 'you' ? 'your comment' : 'the project team');

/**
 * Owner, 10 Nov 2026: the write box on top (it stays in view while the comments scroll), the newest comment first, 30
 * at a time; their comment shows at once as they send it ("Not sent — Try again" if it didn't go); the team's replies
 * arrive by themselves (the task is read again every few seconds), marked "New reply"; every comment has Reply.
 */
function Comments({ projectId, taskId, comments, canComment, timeZone }: { projectId: string; taskId: string; comments: PortalComment[]; canComment: boolean; timeZone: string }) {
  const id = useId();
  const qc = useQueryClient();
  const api = usePortalApi();
  const off = usePreviewOff();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [limit, setLimit] = useState(COMMENTS_PAGE);
  const sectionRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const byId = new Map(comments.map((c) => [c.id, c]));
  const arrivals = useCommentArrivals({
    ids: comments.map((c) => c.id),
    ready: true,
    mine: (cid) => byId.get(cid)?.from === 'you',
    reply: (cid) => Boolean(byId.get(cid)?.replyTo),
    isAway: () => scrolledPast(topRef.current, formRef.current),
    nameOf: (cid) => (byId.get(cid)?.from === 'team' ? 'the project team' : undefined),
  });
  const sending = usePendingComments(
    comments.map((c) => ({ id: c.id, mine: c.from === 'you', body: c.body })),
    'Check your connection and try again.',
  );
  const send = useCallback(
    async (text: string) => {
      try {
        const fresh = await api.comment(projectId, taskId, text);
        taskChanged(qc, projectId, taskId, fresh);
        setSent(true);
      } catch (err) {
        throw new Error(portalProblem(err, 'Check your connection and try again.'));
      }
    },
    [api, projectId, taskId, qc],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSent(false);
    const text = body.trim();
    if (!text) return setProblem('Write a comment first.');
    setProblem(null);
    setBody('');
    sending.send(text, send);
  };
  const takeBack = (p: PendingComment) => {
    sending.drop(p.key);
    setBody((b) => (b.trim() ? `${b}\n${p.body}` : p.body));
    boxRef.current?.focus();
  };
  const reply = async (to: PortalComment, text: string) => {
    try {
      const fresh = await api.comment(projectId, taskId, text, to.id);
      taskChanged(qc, projectId, taskId, fresh);
    } catch (err) {
      throw new Error(portalProblem(err, 'Couldn’t send your reply.'));
    }
  };

  const shown = comments.filter((c) => !arrivals.held.has(c.id));
  const all = newestFirst(threads(shown), (c) => c.createdAt);
  const grown = all.filter((t) => arrivals.arrived.has(t.comment.id)).length;
  const visible = all.slice(0, limit + grown);
  const empty = visible.length === 0 && sending.pending.length === 0;

  return (
    <div ref={sectionRef}>
      <Section title="Comments">
        <p className="mb-3 text-sm text-ink-2">The project team sees your comments here. Their replies to you appear under them.</p>
        {canComment || arrivals.held.size > 0 ? (
          <div ref={formRef} className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-3 pt-1">
            {canComment ? (
              <form onSubmit={submit} noValidate className="flex flex-col gap-2">
                <label htmlFor={`${id}-box`} className="text-sm font-semibold text-ink">
                  Add a comment
                </label>
                <textarea
                  ref={boxRef}
                  id={`${id}-box`}
                  dir="auto"
                  rows={2}
                  maxLength={COMMENT_MAX}
                  disabled={off.disabled}
                  title={off.title}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setSent(false);
                  }}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? `${id}-problem` : undefined}
                  placeholder="Ask a question or leave a note for the project team"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
                {problem ? (
                  <p id={`${id}-problem`} role="alert" className="text-sm text-danger">
                    {problem}
                  </p>
                ) : null}
                {sent ? (
                  <p role="status" className="text-sm text-success">
                    Comment sent to the project team.
                  </p>
                ) : null}
                <div>
                  <Button type="submit" className={`${TOUCH} ${off.className}`} disabled={off.disabled} title={off.title}>
                    Send comment
                  </Button>
                </div>
              </form>
            ) : null}
            {arrivals.held.size > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-full z-10 mt-1 flex justify-center">
                <NewCommentsButton
                  count={arrivals.held.size}
                  onClick={() => {
                    arrivals.reveal();
                    scrollToListTop(sectionRef.current);
                    listRef.current?.focus({ preventScroll: true });
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div ref={topRef} aria-hidden="true" />
        <p aria-live="polite" className="sr-only">
          {arrivals.announcement}
        </p>
        {empty ? (
          <p className="text-sm text-ink-2">No comments yet.</p>
        ) : (
          <ol ref={listRef} tabIndex={-1} aria-label="Comments, newest first" className="flex flex-col gap-3 outline-none">
            {sending.pending.map((p) => (
              <li key={p.key} className="flex flex-col gap-1" data-unsaved={p.status === 'failed' || undefined}>
                <div className={`rounded-xl border px-3 py-2.5 ${p.status === 'failed' ? 'border-danger/40 bg-danger-soft/30' : 'border-line bg-ground'}`}>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2">
                    <span className="font-semibold text-ink">You</span>
                    {p.status === 'sending' ? <span>Sending…</span> : p.status === 'sent' ? <span>Just now</span> : null}
                  </p>
                  <p data-comment-body className={`mt-1 whitespace-pre-line break-words text-sm text-ink ${OWN_LINES}`}>
                    {p.body}
                  </p>
                </div>
                {p.status === 'failed' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p role="alert" className="text-sm text-danger">
                      Not sent — {p.error}
                    </p>
                    <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => sending.retry(p.key, send)}>
                      Try again
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className={TOUCH} aria-label="Edit the comment that wasn’t sent" onClick={() => takeBack(p)}>
                      Edit
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
            {visible.map((t) => (
              <Thread
                key={t.comment.id}
                thread={t}
                timeZone={timeZone}
                canReply={canComment}
                fresh={arrivals.fresh}
                newReply={t.replies.some((r) => arrivals.arrived.has(r.id) && r.from === 'team')}
                onReply={reply}
              />
            ))}
          </ol>
        )}
        {all.length > visible.length ? (
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => setLimit((n) => n + COMMENTS_PAGE)}>
              Show older comments
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/** One of their comments (or "Comment deleted") with its replies, Reply on each, and the reply box when answering. */
function Thread({
  thread,
  timeZone,
  canReply,
  fresh,
  newReply,
  onReply,
}: {
  thread: { comment: PortalComment; replies: PortalComment[]; deleted?: boolean };
  timeZone: string;
  canReply: boolean;
  fresh: Set<string>;
  newReply: boolean;
  onReply: (to: PortalComment, body: string) => Promise<void>;
}) {
  const off = usePreviewOff();
  const [answering, setAnswering] = useState<PortalComment | null>(null);
  const replyButton = (c: PortalComment) =>
    canReply ? (
      <button
        type="button"
        disabled={off.disabled}
        title={off.title}
        onClick={() => setAnswering(c)}
        aria-label={`Reply to ${whoOf(c)}`}
        className={`mt-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-2 hover:bg-ground hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 ${TOUCH} ${off.className}`}
      >
        Reply
      </button>
    ) : null;
  const { comment, replies, deleted } = thread;
  return (
    <li className="flex flex-col gap-2">
      {deleted ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-2 text-sm italic text-ink-3">Comment deleted</p>
      ) : (
        <div>
          <CommentCard comment={comment} timeZone={timeZone} fresh={fresh.has(comment.id)} />
          {replyButton(comment)}
        </div>
      )}
      {newReply ? <span className="self-start rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">New reply</span> : null}
      {replies.length || answering ? (
        <div className="ms-4 flex flex-col gap-2 border-s-2 border-line ps-3 sm:ms-6">
          {replies.length ? (
            <ol aria-label="Replies" className="flex flex-col gap-2">
              {replies.map((r) => (
                <li key={r.id}>
                  <CommentCard comment={r} timeZone={timeZone} fresh={fresh.has(r.id)} />
                  {replyButton(r)}
                </li>
              ))}
            </ol>
          ) : null}
          {answering ? (
            <PortalReplyBox
              key={answering.id}
              to={whoOf(answering)}
              onCancel={() => setAnswering(null)}
              onSend={async (text) => {
                await onReply(answering, text);
                setAnswering(null);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function PortalReplyBox({ to, onSend, onCancel }: { to: string; onSend: (body: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSend(words);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Couldn’t send your reply.');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={go} noValidate className="flex flex-col gap-2">
      <textarea
        dir="auto"
        rows={2}
        autoFocus
        maxLength={COMMENT_MAX}
        aria-label={`Reply to ${to}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply…"
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={onCancel} aria-label="Cancel reply">
          Cancel
        </Button>
        <Button type="submit" size="sm" className={TOUCH} disabled={!text.trim()} loading={busy}>
          Send reply
        </Button>
      </div>
    </form>
  );
}

function CommentCard({ comment: c, timeZone, fresh = false }: { comment: PortalComment; timeZone: string; fresh?: boolean }) {
  const mine = c.from === 'you';
  return (
    <div
      data-fresh={fresh || undefined}
      className={`rounded-xl border px-3 py-2.5 motion-safe:transition-shadow motion-safe:duration-700 ${mine ? 'border-line bg-ground' : 'border-brand/20 bg-brand/5'} ${fresh ? 'ring-2 ring-brand/40 ring-offset-1 ring-offset-surface' : ''}`}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2">
        <span className="font-semibold text-ink">{mine ? 'You' : 'Project team'}</span>
        <time dateTime={c.createdAt}>{dateTimeText(c.createdAt, timeZone)}</time>
        {c.edited ? <span>(edited)</span> : null}
      </p>
      <p data-comment-body className={`mt-1 whitespace-pre-line break-words text-sm text-ink ${OWN_LINES}`}>{c.body}</p>
    </div>
  );
}
