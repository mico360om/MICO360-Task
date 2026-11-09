import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { portalProblem, type PortalNotice } from '../../api/portal';
import { Button, buttonClass } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePortalApi, usePortalPreview, usePreviewOff } from '../../components/portal/portal-context';
import { noticesRead, usePortalMe, usePortalNotices } from '../../components/portal/portal-queries';
import { Chip, LoadFailed, Loading, TOUCH, usePortalPageName } from '../../components/portal/portal-ui';
import { dateTimeText } from '../../lib/day-words';

/** What each kind of notice is, in a word or two (beside its title). */
const KIND_WORDS: Record<PortalNotice['kind'], string> = {
  reply: 'Reply',
  signOff: 'Sign-off',
  document: 'Document',
  minutes: 'Minutes',
  invitation: 'Invitation',
};

/** Where a notice takes the client: its task, its meeting, or (neither) its project. */
function noticeHref(n: PortalNotice): string {
  const project = `/portal/projects/${encodeURIComponent(n.project.id)}`;
  if (n.taskId) return `${project}/tasks/${encodeURIComponent(n.taskId)}`;
  if (n.meetingId) return `${project}/meetings/${encodeURIComponent(n.meetingId)}`;
  return project;
}

/**
 * 1.23.7 The portal's Notifications (the bell): the newest 50 notices about what the client may still open
 * — a reply to their comment, a task ready for their sign-off, a new document, approved minutes, an
 * invitation — each opening its item and marked read as it opens; "Mark all as read"; the settings.
 */
export function PortalNotificationsPage() {
  const q = usePortalNotices();
  const timeZone = usePortalMe().data?.timeZone;
  const api = usePortalApi();
  const preview = usePortalPreview();
  const off = usePreviewOff();
  const qc = useQueryClient();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  usePortalPageName('Notifications');

  // Read as it opens (the page moves on at once; the bell keeps the server's count when it answers).
  const readOne = useMutation({
    mutationFn: (id: string) => api.readNotice(id),
    onMutate: (id) => noticesRead(qc, id),
    onSuccess: ({ unread }, id) => noticesRead(qc, id, unread),
  });
  const readAll = useMutation({
    mutationFn: () => api.readAllNotices(),
    onSuccess: ({ unread }) => {
      noticesRead(qc, null, unread);
      setStatus('All notifications are marked as read.');
      // The button goes away: the keyboard's place stays on the page.
      heading.current?.focus();
    },
    onError: (err) => setProblem(portalProblem(err, 'Couldn’t mark them as read.')),
  });
  const open = (n: PortalNotice) => {
    if (!n.read && !preview) readOne.mutate(n.id);
  };
  const unread = q.data?.unread ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 id={headingId} ref={heading} tabIndex={-1} className="font-display text-2xl font-bold text-ink outline-none sm:text-3xl">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-ink-2">Replies, documents, sign-offs, minutes and invitations from your projects.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unread > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={`${TOUCH} ${off.className}`}
              disabled={off.disabled}
              title={off.title}
              loading={readAll.isPending}
              onClick={() => {
                setStatus(null);
                setProblem(null);
                readAll.mutate();
              }}
            >
              Mark all as read
            </Button>
          ) : null}
          <Link to="/portal/settings" className={buttonClass('ghost', 'sm', TOUCH)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </svg>
            Notification settings
          </Link>
        </div>
      </div>

      {status ? <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{status}</p> : null}
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}

      {q.isPending ? (
        <Loading what="your notifications" />
      ) : q.isError ? (
        <LoadFailed what="your notifications" onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          titleAs="h2"
          title="No notifications yet."
          description="When the project team replies to you, shares a document, has a task for your sign-off or approves meeting minutes, it appears here."
        />
      ) : (
        <ul aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          {q.data.items.map((n) => (
            <li key={n.id} className="border-b border-line last:border-b-0">
              <Link
                to={noticeHref(n)}
                onClick={() => open(n)}
                className={`flex min-h-11 items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-ground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${n.read ? '' : 'bg-brand/5'}`}
              >
                {/* Unread: a dot and bolder words, and said in words to a screen reader. */}
                <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${n.read ? '' : 'bg-brand'}`} />
                <span className="min-w-0 flex-1">
                  {n.read ? null : <span className="sr-only">Unread: </span>}
                  <span className={`block break-words text-sm text-ink ${n.read ? 'font-medium' : 'font-semibold'}`}>
                    <bdi>{n.title}</bdi>
                  </span>
                  {n.body ? (
                    <span className="mt-0.5 block text-sm text-ink-2 [overflow-wrap:anywhere]">
                      <bdi>{n.body}</bdi>
                    </span>
                  ) : null}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                    <Chip tone={n.read ? 'neutral' : 'brand'}>{KIND_WORDS[n.kind]}</Chip>
                    <bdi>{n.project.name}</bdi>
                    <span aria-hidden="true">·</span>
                    <time dateTime={n.createdAt}>{dateTimeText(n.createdAt, timeZone)}</time>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
