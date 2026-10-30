import { Link } from 'react-router-dom';
import { Reveal } from '../ui/Reveal';
import { relativeTime } from '../../lib/relative-time';
import { useApprovals } from './ToApproveSection';

/** How many waiting tasks the card lists (the rest are on My Tasks). */
const SHOWN = 5;

/**
 * The Dashboard's "Waiting for your approval (N)" card, for the people who can approve (they run a
 * project, or are an administrator): the longest waiting first, each opening the task (whose panel
 * has Approve and Send back). Nothing waiting: one line, as the Dashboard's other cards say it.
 * Hidden for everyone else.
 */
export function ApprovalsCard({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const q = useApprovals();
  if (!q.data?.canApprove) return null;
  const tasks = q.data.tasks;
  return (
    <Reveal>
      <section className="card p-5" aria-labelledby="dash-approvals-heading" data-testid="approvals-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="dash-approvals-heading" className="eyebrow">
            Waiting for your approval ({tasks.length})
          </h2>
          {tasks.length > 0 ? (
            <Link to="/my-tasks#to-approve" className="tap text-xs font-semibold text-brand hover:underline">
              Review all
            </Link>
          ) : null}
        </div>
        {tasks.length === 0 ? (
          <p className="py-2 text-center text-sm text-ink-2">Nothing is waiting for your approval.</p>
        ) : (
          <ul className="flex flex-col">
            {tasks.slice(0, SHOWN).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  className="flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2 py-2 text-start transition-colors hover:bg-ground [@media(pointer:coarse)]:min-h-11"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="flex-none rounded bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{t.key}</span>
                    <bdi title={t.title} className="truncate text-ink">
                      {t.title}
                    </bdi>
                  </span>
                  <span className="truncate text-xs text-ink-2">
                    <bdi>{t.project.name}</bdi>
                    {t.requestedBy ? (
                      <>
                        {' · '}finished by <bdi>{t.requestedBy.name}</bdi>
                      </>
                    ) : null}
                    {t.approvalRequestedAt ? ` · ${relativeTime(t.approvalRequestedAt)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {tasks.length > SHOWN ? <p className="mt-2 text-xs text-ink-2">+{tasks.length - SHOWN} more on My Tasks.</p> : null}
      </section>
    </Reveal>
  );
}
