import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { tasksApi, type ApprovalTask } from '../../api/tasks';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { relativeTime } from '../../lib/relative-time';
import { ProjectAvatar } from '../ProjectAvatar';
import { Button } from '../ui/Button';
import { SendBackDialog } from './SendBackDialog';
import { WaitingIcon } from './ApprovalChip';
import { approveLabel, approvedNotice, sendBackLabel, sentBackNotice } from '../../lib/approvals';

/** The query behind the To approve list and the Dashboard card. */
export const APPROVALS_KEY = ['approvals'] as const;

/** The tasks waiting for the signed-in person's approval (and whether they approve any project's tasks). */
export function useApprovals() {
  return useQuery({ queryKey: APPROVALS_KEY, queryFn: () => tasksApi(apiClient).approvals(), staleTime: 30_000 });
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * My Tasks' "To approve" list: the tasks finished by others that wait for this person's OK (they run
 * the project, or are an administrator), the longest waiting first, each with Approve and Send back.
 * Shown only while something waits (the daily email's link lands here: #to-approve).
 */
export function ToApproveSection({ onOpen }: { onOpen: (taskId: string) => void }) {
  const qc = useQueryClient();
  const q = useApprovals();
  const tasks = q.data?.tasks ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [sending, setSending] = useState<ApprovalTask | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  // Opened from the morning email's link: bring the list into view once it is there.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || tasks.length === 0 || window.location.hash !== '#to-approve') return;
    scrolled.current = true;
    ref.current?.scrollIntoView?.({ block: 'start' });
  }, [tasks.length]);

  async function decided(text: string) {
    setSaid(text);
    await invalidateTaskQueries(qc);
  }
  async function approve(t: ApprovalTask) {
    setBusy(t.id);
    setProblem(null);
    try {
      await tasksApi(apiClient).approve(t.id, t.version);
      await decided(approvedNotice(t.key));
    } catch (e) {
      setProblem({ id: t.id, text: messageOf(e, 'Couldn’t approve it. Please try again.') });
      void qc.invalidateQueries({ queryKey: APPROVALS_KEY });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p role="status" aria-live="polite" className={said ? 'mb-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success' : 'sr-only'}>
        {said}
      </p>
      {tasks.length > 0 ? (
        <section ref={ref} id="to-approve" aria-labelledby="to-approve-heading" className="card mb-4 scroll-mt-20 p-4">
          <h2 id="to-approve-heading" className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <span className="text-warning">
              <WaitingIcon size={16} />
            </span>
            To approve ({tasks.length})
          </h2>
          <p className="mt-0.5 text-xs text-ink-2">Tasks others have finished, waiting for your OK. They don’t count as done until you approve them.</p>
          <ul className="mt-3 divide-y divide-line">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-[1_1_16rem]">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    aria-label={`Open ${t.key}: ${t.title}`}
                    className="flex min-w-0 max-w-full items-center gap-2 text-start [@media(pointer:coarse)]:!min-h-11"
                  >
                    <span className="flex-none rounded bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{t.key}</span>
                    <bdi className="truncate text-sm font-medium text-ink hover:text-brand">{t.title}</bdi>
                  </button>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-2">
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <ProjectAvatar project={t.project} size="xs" />
                      <bdi className="truncate">{t.project.name}</bdi>
                    </span>
                    {t.requestedBy ? (
                      <span>
                        Finished by <bdi>{t.requestedBy.name}</bdi>
                        {t.approvalRequestedAt ? ` · ${relativeTime(t.approvalRequestedAt)}` : ''}
                      </span>
                    ) : null}
                  </div>
                  {problem?.id === t.id ? (
                    <p role="alert" className="mt-1 text-xs font-medium text-danger">
                      {problem.text}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-none gap-2">
                  <Button size="sm" aria-label={approveLabel(t.key)} loading={busy === t.id} disabled={busy !== null} onClick={() => void approve(t)} className="[@media(pointer:coarse)]:!min-h-11">
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={sendBackLabel(t.key)}
                    disabled={busy !== null}
                    onClick={() => {
                      setSendError(null);
                      setSending(t);
                    }}
                    className="[@media(pointer:coarse)]:!min-h-11"
                  >
                    Send back
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sending ? (
        <SendBackDialog
          taskKey={sending.key}
          taskTitle={sending.title}
          busy={busy === sending.id}
          error={sendError}
          onClose={() => setSending(null)}
          onSend={(reason) => {
            const t = sending;
            setBusy(t.id);
            setSendError(null);
            tasksApi(apiClient)
              .sendBack(t.id, reason, t.version)
              .then(async () => {
                setSending(null);
                await decided(sentBackNotice(t.key));
              })
              .catch((e: unknown) => setSendError(messageOf(e, 'Couldn’t send it back. Please try again.')))
              .finally(() => setBusy(null));
          }}
        />
      ) : null}
    </>
  );
}
