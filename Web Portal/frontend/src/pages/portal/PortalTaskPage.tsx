import { useId, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isNotShared, portal, portalProblem, type PortalComment, type PortalTaskView } from '../../api/portal';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PortalSendBackDialog } from '../../components/portal/PortalSendBackDialog';
import { taskChanged, usePortalTask } from '../../components/portal/portal-queries';
import { BackLink, Chip, day, KeyChip, LoadFailed, Loading, NotShared, OWN_LINES, Section, StatusBadge, TOUCH } from '../../components/portal/portal-ui';
import { dateTimeText } from '../../lib/day-words';
import { usePageName } from '../../lib/page-meta';
import { NeedsModule, usePortalProjectContext } from './PortalProjectLayout';

/** The longest comment the server keeps. */
const COMMENT_MAX = 10_000;

/**
 * 1.23 One shared task in the Client portal: its status, due day and (when shared) description;
 * with the Comment action their comments and the team's replies marked "Visible to client" (as
 * "Project team", never a name); with Sign off, Accept or Send back once it is finished.
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
  usePageName(q.data ? `${q.data.task.key} ${q.data.task.title}` : null);
  const back = `/portal/projects/${encodeURIComponent(projectId)}/progress`;

  return (
    <div className="flex flex-col gap-4">
      <BackLink to={back}>Progress &amp; tasks</BackLink>
      {q.isPending ? (
        <Loading what="the task" />
      ) : q.isError ? (
        isNotShared(q.error) ? <NotShared backTo={back} backLabel="Back to the tasks" /> : <LoadFailed what="the task" onRetry={() => void q.refetch()} />
      ) : (
        <TaskBody projectId={projectId} taskId={taskId} view={q.data} timeZone={project.timeZone} />
      )}
    </div>
  );
}

function TaskBody({ projectId, taskId, view, timeZone }: { projectId: string; taskId: string; view: PortalTaskView; timeZone: string }) {
  const { task, comments, can } = view;
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<'accept' | 'sendBack' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => portal.accept(projectId, taskId),
    onSuccess: (fresh) => {
      taskChanged(qc, projectId, taskId, fresh);
      setConfirming(null);
      setNotice('Thank you. The project team can see that you accepted this task.');
    },
    onError: (err) => setProblem(portalProblem(err, 'Couldn’t accept the task.')),
  });
  const sendBack = useMutation({
    mutationFn: (reason: string) => portal.sendBack(projectId, taskId, reason),
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
            <Button type="button" className={TOUCH} onClick={() => open('accept')}>
              Accept
            </Button>
            <Button type="button" variant="secondary" className={TOUCH} onClick={() => open('sendBack')}>
              Send back
            </Button>
          </div>
        </Section>
      ) : task.acceptedOn ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">You accepted this task on {day(task.acceptedOn)}.</p>
      ) : null}

      {comments ? <Comments projectId={projectId} taskId={taskId} comments={comments} canComment={can.comment} timeZone={timeZone} /> : null}

      {confirming === 'accept' ? (
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
      {confirming === 'sendBack' ? (
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

/** Their own comments, each with the team's replies to it (marked "Visible to client") under it. */
function threads(comments: PortalComment[]): { comment: PortalComment; replies: PortalComment[] }[] {
  const mine = comments.filter((c) => c.from === 'you');
  const ids = new Set(mine.map((c) => c.id));
  const loose = comments.filter((c) => c.from === 'team' && (!c.replyTo || !ids.has(c.replyTo)));
  return [
    ...mine.map((c) => ({ comment: c, replies: comments.filter((r) => r.from === 'team' && r.replyTo === c.id) })),
    ...loose.map((c) => ({ comment: c, replies: [] })),
  ];
}

function Comments({ projectId, taskId, comments, canComment, timeZone }: { projectId: string; taskId: string; comments: PortalComment[]; canComment: boolean; timeZone: string }) {
  const id = useId();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const post = useMutation({
    mutationFn: (text: string) => portal.comment(projectId, taskId, text),
    onSuccess: (fresh) => {
      taskChanged(qc, projectId, taskId, fresh);
      setBody('');
      setSent(true);
    },
    onError: (err) => setProblem(portalProblem(err, 'Couldn’t send your comment.')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSent(false);
    const text = body.trim();
    if (!text) return setProblem('Write a comment first.');
    setProblem(null);
    post.mutate(text);
  };

  return (
    <Section title="Comments">
      <p className="mb-3 text-sm text-ink-2">The project team sees your comments here. Their replies to you appear under them.</p>
      {comments.length === 0 ? (
        <p className="text-sm text-ink-2">No comments yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {threads(comments).map(({ comment, replies }) => (
            <li key={comment.id} className="flex flex-col gap-2">
              <CommentCard comment={comment} timeZone={timeZone} />
              {replies.length ? (
                <ol aria-label="Replies" className="ms-4 flex flex-col gap-2 border-s-2 border-line ps-3 sm:ms-6">
                  {replies.map((r) => (
                    <li key={r.id}>
                      <CommentCard comment={r} timeZone={timeZone} />
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canComment ? (
        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          <label htmlFor={`${id}-box`} className="text-sm font-semibold text-ink">Add a comment</label>
          <textarea
            id={`${id}-box`}
            dir="auto"
            rows={3}
            maxLength={COMMENT_MAX}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSent(false);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            placeholder="Ask a question or leave a note for the project team"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          {problem ? <p id={`${id}-problem`} role="alert" className="text-sm text-danger">{problem}</p> : null}
          {sent ? <p role="status" className="text-sm text-success">Comment sent to the project team.</p> : null}
          <div>
            <Button type="submit" className={TOUCH} loading={post.isPending}>
              Send comment
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

function CommentCard({ comment: c, timeZone }: { comment: PortalComment; timeZone: string }) {
  const mine = c.from === 'you';
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${mine ? 'border-line bg-ground' : 'border-brand/20 bg-brand/5'}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2">
        <span className="font-semibold text-ink">{mine ? 'You' : 'Project team'}</span>
        <time dateTime={c.createdAt}>{dateTimeText(c.createdAt, timeZone)}</time>
        {c.edited ? <span>(edited)</span> : null}
      </p>
      <p className={`mt-1 whitespace-pre-line break-words text-sm text-ink ${OWN_LINES}`}>{c.body}</p>
    </div>
  );
}
