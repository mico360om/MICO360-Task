import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { BIN_KEY, binApi, type BinDetail } from '../../api/recycle-bin';
import { ApiError } from '../../lib/api-client';
import { binBannerLead, binCountdown, eraseText, restoredNotice, restoreText } from '../../lib/recycle-bin';
import { buildTimeline } from '../../lib/activity-feed';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { showTaskNotice } from '../../lib/task-notice';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { todayKey } from '../../lib/due-date';
import { dayText, instantDayText } from '../../lib/day-words';
import { formatSize } from '../task-drawer/attachments';
import { TaskKey } from '../TaskKey';
import { ProjectAvatar } from '../ProjectAvatar';
import { PriorityBadge } from '../ui/PriorityBadge';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { TOUCH_TALL } from '../../lib/touch';
import type { Priority } from '../../api/tasks';

/** A section of the read-only view: its heading and what it holds (nothing when it is empty). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5" aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <div className="mt-1.5 text-sm text-ink">{children}</div>
    </section>
  );
}

/**
 * Recycle Bin: a deleted task opened (from the bin, an old notification, an email link): for someone who
 * may restore it, the task as it was, read-only, under a banner — "In the Recycle Bin — deleted by Ali on
 * 3 Nov · 53 days left" — with Restore (a copy of a series deleted as a whole: this task, or all of
 * them) and, for an administrator, Delete forever. Anyone else: "This task was deleted".
 */
export function DeletedTaskPanel({ taskId, onClose, closeButton }: { taskId: string; onClose: () => void; closeButton: ReactNode }) {
  const queryClient = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const today = todayKey(timeZone);
  const q = useQuery({ queryKey: [...BIN_KEY, 'task', taskId], queryFn: () => binApi(apiClient).detail(taskId), retry: false });
  const [problem, setProblem] = useState<string | null>(null);
  const [erasing, setErasing] = useState(false);
  const failed = (e: unknown) => setProblem(e instanceof ApiError && e.message ? e.message : 'Couldn’t do that. Check your connection and try again.');

  const restoreM = useMutation({
    mutationFn: (whole: boolean) => binApi(apiClient).restore([taskId], whole),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: BIN_KEY });
      if (!r.restored.length) return setProblem(restoreText(r));
      showTaskNotice({ ...restoredNotice(r), taskId: null });
      // The panel reads the task again: it is back, so the task itself shows.
      void invalidateTaskQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: failed,
  });
  const eraseM = useMutation({
    mutationFn: () => binApi(apiClient).erase([taskId]),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: BIN_KEY });
      setErasing(false);
      showTaskNotice({ text: eraseText(r).replace(/\.$/, ''), taskId: null, key: null });
      onClose();
    },
    onError: (e) => {
      setErasing(false);
      failed(e);
    },
  });

  if (q.isLoading) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Loading task" aria-busy="true" className="flex h-full w-full flex-col gap-3 border-l border-line bg-surface p-5 text-ink-2">
        <p role="status">Loading…</p>
        {closeButton}
      </div>
    );
  }
  if (!q.data) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Task deleted" className="flex h-full w-full flex-col gap-3 border-l border-line bg-surface p-5">
        <p role="alert" className="text-sm text-ink">This task was deleted.</p>
        <div className="flex gap-2">{closeButton}</div>
      </div>
    );
  }

  const d: BinDetail = q.data;
  const t = d.task;
  const countdown = binCountdown(d.bin.daysLeft);
  const busy = restoreM.isPending || eraseM.isPending;
  const history = buildTimeline(d.history.map((h) => ({ id: h.id, action: h.action, actorName: h.actor?.name ?? 'Someone', createdAt: h.createdAt, meta: h.meta })));
  const day = (iso: string | null) => (iso ? dayText(iso.slice(0, 10)) : '—');

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="deleted-task-title" className="flex h-full w-full flex-col border-l border-line bg-surface">
      <div className="flex-none border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TaskKey value={t.key} size="lg" />
              <StatusPill category={t.status.category} label={t.status.name} />
            </div>
            <h2 id="deleted-task-title" dir="auto" className="mt-1.5 break-words font-display text-xl font-bold text-ink line-through decoration-ink-3/60">
              {t.title}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
              <ProjectAvatar project={t.project} size="xs" />
              <bdi>{t.project.name}</bdi>
            </p>
          </div>
          <div className="flex-none">{closeButton}</div>
        </div>
        {/* The banner: in the bin, who deleted it, when, how long is left — and what this person may do. */}
        <div role="status" className="mt-3 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-ink">
          <p className="font-medium">
            {binBannerLead(d.bin, timeZone, today)}
            <span aria-hidden="true"> · </span>
            <span data-tone={countdown.tone} className={`font-semibold ${countdown.tone === 'danger' ? 'text-danger' : countdown.tone === 'warning' ? 'text-warning' : 'text-ink'}`}>
              {countdown.text}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {d.bin.batch ? (
              <>
                <Button size="sm" onClick={() => restoreM.mutate(false)} loading={restoreM.isPending && restoreM.variables === false} disabled={busy} className={TOUCH_TALL}>
                  Restore this task
                </Button>
                <Button size="sm" variant="secondary" onClick={() => restoreM.mutate(true)} loading={restoreM.isPending && restoreM.variables === true} disabled={busy} className={TOUCH_TALL}>
                  Restore all {d.bin.batch.size}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => restoreM.mutate(false)} loading={restoreM.isPending} disabled={busy} className={TOUCH_TALL}>
                Restore
              </Button>
            )}
            {d.bin.canErase ? (
              <Button size="sm" variant="ghost" onClick={() => setErasing(true)} disabled={busy} className={`text-danger hover:text-danger ${TOUCH_TALL}`}>
                Delete forever
              </Button>
            ) : null}
          </div>
          {d.bin.batch ? <p className="mt-1.5 text-xs text-ink-2">Deleted with its repeating series ({d.bin.batch.size} tasks).</p> : null}
          {problem ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {problem}
            </p>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        <p className="sr-only">This task is in the Recycle Bin. It can’t be changed until it is restored.</p>
        <Section title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-2">Priority</dt>
            <dd>
              <PriorityBadge priority={t.priority as Priority} />
            </dd>
            <dt className="text-ink-2">Start</dt>
            <dd>{day(t.startDate)}</dd>
            <dt className="text-ink-2">Due</dt>
            <dd>{day(t.dueDate)}</dd>
            {t.isMilestone ? (
              <>
                <dt className="text-ink-2">Milestone</dt>
                <dd>Yes</dd>
              </>
            ) : null}
            {t.repeats ? (
              <>
                <dt className="text-ink-2">Repeats</dt>
                <dd>Part of a repeating series</dd>
              </>
            ) : null}
            <dt className="text-ink-2">Created</dt>
            <dd>
              {instantDayText(t.createdAt, timeZone)}
              {t.createdBy ? ` by ${t.createdBy.name}` : ''}
            </dd>
            {t.formerKeys.length ? (
              <>
                <dt className="text-ink-2">Old numbers</dt>
                <dd>{t.formerKeys.join(', ')}</dd>
              </>
            ) : null}
          </dl>
        </Section>
        {t.description ? (
          <Section title="Description">
            <p dir="auto" className="whitespace-pre-wrap break-words">
              {t.description}
            </p>
          </Section>
        ) : null}
        {d.assignees.length ? <Section title="Assigned to">{d.assignees.map((a) => a.name).join(', ')}</Section> : null}
        {d.tags.length ? (
          <Section title="Tags">
            <ul className="flex flex-wrap gap-1.5">
              {d.tags.map((tag) => (
                <li key={tag.name} className="rounded-md bg-ground px-2 py-0.5 text-xs font-medium text-ink-2">
                  {tag.name}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {d.contacts.length ? <Section title="External contacts">{d.contacts.map((c) => (c.company ? `${c.name} (${c.company})` : c.name)).join(', ')}</Section> : null}
        {d.blockers.length ? <Section title="Blocked by">{d.blockers.map((b) => `${b.key} ${b.title}`).join(', ')}</Section> : null}
        {d.checklists.map((list, i) => (
          <Section key={`${list.title}-${i}`} title={list.title}>
            <ul className="space-y-0.5">
              {list.items.map((item, j) => (
                <li key={j} style={{ paddingInlineStart: `${Math.min(item.depth, 4) * 1.25}rem` }} className={item.done ? 'text-ink-2 line-through' : ''}>
                  <span aria-hidden="true">{item.done ? '☑ ' : '☐ '}</span>
                  <span className="sr-only">{item.done ? 'Done: ' : 'Not done: '}</span>
                  <span dir="auto">{item.text}</span>
                </li>
              ))}
            </ul>
          </Section>
        ))}
        {d.files.length ? (
          <Section title={`Files (${d.files.length})`}>
            <ul className="space-y-0.5">
              {d.files.map((f, i) => (
                <li key={i}>
                  <bdi>{f.filename}</bdi> <span className="text-ink-3">· {formatSize(f.sizeBytes)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-ink-3">Restore the task to open its files.</p>
          </Section>
        ) : null}
        {d.comments.length ? (
          <Section title={`Comments (${d.comments.length})`}>
            <ul className="space-y-3">
              {d.comments.map((c) => (
                <li key={c.id}>
                  <p className="text-xs text-ink-2">
                    <span className="font-semibold text-ink">{c.author?.name ?? 'Someone'}</span> · {instantDayText(c.createdAt, timeZone)}
                  </p>
                  <p dir="auto" className="whitespace-pre-wrap break-words">
                    {c.deleted ? <em className="text-ink-3">Comment deleted</em> : c.body}
                  </p>
                  {c.replies?.length ? (
                    <ul className="mt-1.5 space-y-1.5 border-s-2 border-line ps-3">
                      {c.replies.map((r) => (
                        <li key={r.id}>
                          <p className="text-xs text-ink-2">
                            <span className="font-semibold text-ink">{r.author?.name ?? 'Someone'}</span> · {instantDayText(r.createdAt, timeZone)}
                          </p>
                          <p dir="auto" className="whitespace-pre-wrap break-words">
                            {r.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {history.length ? (
          <Section title="History">
            <ul className="space-y-1">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{h.actorName}</span> {h.text}
                  {h.createdAt ? <span className="text-ink-3"> · {instantDayText(h.createdAt, timeZone)}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      {erasing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog title="Delete forever?" confirmLabel="Delete forever" keepLabel="Keep it" busy={eraseM.isPending} onConfirm={() => eraseM.mutate()} onClose={() => setErasing(false)}>
            {t.key} “{t.title}” and everything it had — comments, files, checklists and history — will be deleted. This can’t be undone.
          </ConfirmDialog>
        </div>
      ) : null}
    </div>
  );
}
