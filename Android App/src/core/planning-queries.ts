import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import type { WeekStart } from '../lib/calendar';
import { companyTodayKey } from '../lib/due-date';
import type { WorkloadPerson, WorkloadTask } from '../lib/planning-api';
import { refresh } from '../lib/refresh';
import { samePersonPlaceholder } from '../lib/same-person';
import { planningRoot, timelineKey, timelineTasksKey } from '../lib/timeline';
import { appliedText, applyProblem, limitProblemText, workloadKey } from '../lib/workload';

/*
 * Timeline and Workload (Stage 3): read from the server as the signed-in person — every key starts
 * ['planning', userId], every request carries `asUser` — and never from the offline copy or the
 * offline queue, so sign-out's cache clear drops it all and the next person on the phone sees none
 * of it. Read again whenever the screen opens (staleTime 0), with the company day in the key so a
 * new day reads again.
 */

export function useTimeline(range: { from: string; to: string; weekStart: WeekStart }) {
  const { resources } = useServices();
  const userId = useUserId() ?? '';
  const today = companyTodayKey();
  return useQuery({
    queryKey: timelineKey(userId, range.from, range.to, range.weekStart, today),
    queryFn: ({ signal }) => resources.planning.timeline(range, { asUser: userId, signal }),
    enabled: !!userId,
    placeholderData: samePersonPlaceholder(userId),
    staleTime: 0,
  });
}

/**
 * One project's task rows for the shown weeks, read when its row is opened. No placeholder (as the
 * website's): while other weeks load, the old rows are not shown as if they were theirs.
 */
export function useTimelineTasks(projectId: string, range: { from: string; to: string }, enabled: boolean) {
  const { resources } = useServices();
  const userId = useUserId() ?? '';
  const today = companyTodayKey();
  return useQuery({
    queryKey: timelineTasksKey(userId, projectId, range.from, range.to, today),
    queryFn: ({ signal }) => resources.planning.timelineTasks(projectId, range, { asUser: userId, signal }),
    enabled: enabled && !!userId,
    staleTime: 0,
  });
}

/** One week of Workload ('' = every project), as the server counts it. */
export function useWorkload(week: string, projectId: string) {
  const { resources } = useServices();
  const userId = useUserId() ?? '';
  const today = companyTodayKey();
  return useQuery({
    queryKey: workloadKey(userId, week, projectId, today),
    queryFn: ({ signal }) => resources.planning.workload({ week, projectId: projectId || undefined }, { asUser: userId, signal }),
    enabled: !!userId,
    placeholderData: samePersonPlaceholder(userId),
    staleTime: 0,
  });
}

export type ApplyResult = { ok: true; text: string } | { ok: false; text: string };

/**
 * Apply a day's suggestion (Review Focus 4): give the task to the suggested teammate, or move it to
 * the lighter day — sent with the version shown, so the server refuses it (409) when the task
 * changed since; that is said in the website's plain words. Whether it worked or not, the numbers
 * are read again. One at a time: while one is on its way another tap sends nothing (null). Never
 * queued for later — a suggestion is only worth making on today's numbers.
 */
export function useApplySuggestion(): { apply(task: WorkloadTask, person: WorkloadPerson): Promise<ApplyResult | null>; busyTaskId: string | null } {
  const { resources } = useServices();
  const qc = useQueryClient();
  const userId = useUserId() ?? '';
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const busy = useRef(false);
  const apply = useCallback(
    async (task: WorkloadTask, person: WorkloadPerson): Promise<ApplyResult | null> => {
      const s = task.suggestion;
      if (!s || !userId || busy.current) return null;
      busy.current = true;
      setBusyTaskId(task.id);
      try {
        if (s.kind === 'reassign') await resources.planning.swapAssignee(task.id, { from: person.id, to: s.to.id, expectedVersion: task.version }, { asUser: userId });
        else await resources.planning.moveDue(task.id, { dueDate: s.date, expectedVersion: task.version }, { asUser: userId });
        return { ok: true, text: appliedText(s, task.key) };
      } catch (err) {
        return { ok: false, text: applyProblem(err, { key: task.key, suggestion: s, from: person.name }) };
      } finally {
        // Either way the numbers are read again, so they show what really happened — and "Saving…"
        // lasts until they are (the website's apply.isPending). A failed re-read changes nothing.
        refresh(qc, [{ queryKey: ['tasks'] }, { queryKey: ['task', task.id] }]);
        try {
          await qc.invalidateQueries({ queryKey: planningRoot(userId) });
        } catch {
          // The numbers stay as they were; a pull reads them again.
        }
        busy.current = false;
        setBusyTaskId(null);
      }
    },
    [resources, qc, userId],
  );
  return { apply, busyTaskId };
}

/** The company's daily limit (administrators): null when saved, else why not; the numbers are read again either way. */
export function useSetDailyLimit(): { set(value: number): Promise<string | null> } {
  const { resources } = useServices();
  const qc = useQueryClient();
  const userId = useUserId() ?? '';
  const set = useCallback(
    async (value: number): Promise<string | null> => {
      try {
        await resources.planning.setDailyLimit(value, { asUser: userId });
        return null;
      } catch (err) {
        return limitProblemText(err);
      } finally {
        await qc.invalidateQueries({ queryKey: planningRoot(userId) });
      }
    },
    [resources, qc, userId],
  );
  return { set };
}
