import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { tasksApi } from '../api/tasks';
import { stepsAt, useTaskSteps, type StepDirection, type TaskStepper } from './task-steps';

/**
 * The app shell's task panel: Previous / Next through the list the open task came from (see
 * lib/task-steps), while the person is still on that list's page. Each step puts the other task in
 * the address (a new entry, so Back goes back to the one before), and the tasks either side are read
 * ahead so a step opens at once. No list, or a task not in it: no steps.
 */
export function useTaskStepper(taskId: string | null): TaskStepper | undefined {
  const { ids, path, stepped } = useTaskSteps();
  const { pathname } = useLocation();
  const [, setParams] = useSearchParams();
  const qc = useQueryClient();
  const place = taskId && path === pathname ? stepsAt(ids, taskId) : null;
  const previous = place?.previous ?? null;
  const next = place?.next ?? null;

  useEffect(() => {
    for (const id of [next, previous]) {
      if (id) void qc.prefetchQuery({ queryKey: ['task', id], queryFn: () => tasksApi(apiClient).get(id), staleTime: 30_000 });
    }
  }, [qc, next, previous]);

  if (!place) return undefined;
  const go = (direction: StepDirection, id: string) => () => {
    useTaskSteps.getState().step(direction);
    setParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('task', id);
      return params;
    });
  };
  return {
    position: place.position,
    total: place.total,
    onPrevious: previous ? go('previous', previous) : undefined,
    onNext: next ? go('next', next) : undefined,
    focus: stepped,
  };
}
