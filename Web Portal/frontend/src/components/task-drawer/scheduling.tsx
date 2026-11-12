import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { schedulingApi } from '../../api/scheduling';
import type { ApiTask } from '../../api/tasks';
import { minutesAt, timeLabel } from '../../lib/calendar-hours';
import { dueDayKey, todayKey } from '../../lib/due-date';
import { dayLabel } from '../calendar/calendar-ui';
import { PlanTimeDialog, ReminderEditor, reasonOf } from '../calendar/scheduling-dialogs';
import { HATCH_STYLE } from '../calendar/schedule-chips';

/**
 * The task panel's calendar scheduling (owner, 11 Nov 2026): "Reminders" — mine on this task, and the
 * ones I set for its people (Remind me) — and "Planned time": the time its people planned to work on it
 * (work blocks), with Plan time. Both fold; the Calendar shows the same.
 */
export function TaskScheduling({ task, timeZone }: { task: ApiTask; timeZone: string }) {
  const qc = useQueryClient();
  const api = schedulingApi(apiClient);
  const [openReminders, setOpenReminders] = useState(false);
  const [openBlocks, setOpenBlocks] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const done = !!task.completedAt;
  // Release B x task archive: an archived task is read-only (nothing can be added; the server refuses it too).
  const archived = !!task.archivedAt;
  const people = new Map((task.assignees ?? []).map((a) => [a.id, a.name]));
  const blocksQ = useQuery({ queryKey: ['task-blocks', task.id], queryFn: () => api.blocks(task.id), enabled: openBlocks });
  const remindersQ = useQuery({ queryKey: ['task-reminders', task.id], queryFn: () => api.reminders(task.id), enabled: openReminders });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['task-blocks', task.id] });
    void qc.invalidateQueries({ queryKey: ['calendar'] });
    void qc.invalidateQueries({ queryKey: ['workload'] });
  };
  const head = (id: string, title: string, open: boolean, toggle: () => void, count?: number) => (
    <h3 id={id} className="m-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-start eyebrow [@media(pointer:coarse)]:min-h-11"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className={`flex-none transition-transform ${open ? 'rotate-90' : ''} rtl:-scale-x-100`}>
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span>{title}</span>
        {count ? <span className="font-normal normal-case tracking-normal text-ink-3">{count}</span> : null}
      </button>
    </h3>
  );
  const blocks = blocksQ.data?.blocks ?? [];
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="task-reminders-heading">
        {head('task-reminders-heading', 'Reminders', openReminders, () => setOpenReminders((o) => !o), remindersQ.data?.reminders.length)}
        {openReminders ? (
          <div className="mt-2">
            {archived ? (
              <p className="mb-2 text-xs text-ink-2">This task is archived — its reminders and planned time wait (not sent, not counted) until it is unarchived.</p>
            ) : done ? (
              <p className="mb-2 text-xs text-ink-2">This task is done — its reminders wait (not sent) until it is reopened.</p>
            ) : null}
            {said ? <p role="status" className="mb-2 text-xs text-ink-2">{said}</p> : null}
            <ReminderEditor task={task} timeZone={timeZone} people={people} compact onChanged={setSaid} />
          </div>
        ) : null}
      </section>
      <section aria-labelledby="task-blocks-heading">
        {head('task-blocks-heading', 'Planned time', openBlocks, () => setOpenBlocks((o) => !o), blocks.length || undefined)}
        {openBlocks ? (
          <div className="mt-2 flex flex-col gap-2">
            {blocksQ.isLoading ? <div className="skeleton h-8" /> : null}
            {blocks.length ? (
              <ul aria-label="Planned time" className="flex flex-col gap-1.5">
                {blocks.map((b) => {
                  const s = minutesAt(b.startAt, timeZone);
                  const e = minutesAt(b.endAt, timeZone);
                  const words = `${dayLabel(s.day)}, ${timeLabel(s.minutes)}–${timeLabel(e.minutes)}`;
                  return (
                    <li key={b.id} style={HATCH_STYLE} className="flex items-center gap-2 rounded-lg border border-dashed border-brand/50 bg-surface px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block text-ink">{words}</span>
                        <span className="block text-[11px] text-ink-2">
                          {b.userName}
                          {b.plannedById !== b.userId ? ` · planned by ${b.plannedByName}` : ''}
                        </span>
                      </span>
                      {b.canChange ? (
                        <button
                          type="button"
                          onClick={async () => {
                            setProblem(null);
                            try {
                              await api.removeBlock(task.id, b.id);
                              refresh();
                            } catch (err) {
                              setProblem(`Couldn’t remove it — ${reasonOf(err)}.`);
                            }
                          }}
                          aria-label={`Remove the planned time ${words}`}
                          className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-danger hover:border-danger/50 [@media(pointer:coarse)]:min-h-11"
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : blocksQ.isSuccess ? (
              <p className="text-sm text-ink-2">No time planned yet.</p>
            ) : null}
            {problem ? <p role="alert" className="text-sm text-danger">{problem}</p> : null}
            {!done && !archived && (blocksQ.data?.forPeople.length ?? 0) > 0 ? (
              <button type="button" onClick={() => setPlanning(true)} className="self-start rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-brand hover:border-brand [@media(pointer:coarse)]:min-h-11">
                Plan time
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      {planning ? (
        <PlanTimeDialog
          task={{ id: task.id, key: task.key, title: task.title }}
          options={[]}
          day={dueDayKey(task.dueDate, timeZone) ?? todayKey(timeZone)}
          minutes={9 * 60}
          timeZone={timeZone}
          people={people}
          onClose={() => setPlanning(false)}
          onSave={async (taskId, body) => {
            try {
              await api.addBlock(taskId, body);
              refresh();
              setPlanning(false);
              return null;
            } catch (err) {
              return `Couldn’t plan the time — ${reasonOf(err)}.`;
            }
          }}
        />
      ) : null}
    </div>
  );
}
