import { useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useServices } from './providers';
import { owned } from './queries';
import { isNetworkError } from '../lib/api-client';
import { afterApprovalDecision, afterApprovalRefused } from '../lib/task-cache';
import type { ResourcesApi } from '../lib/resources';
import type { ApiTask, ApprovalsAnswer } from '../lib/types';

/** The approvals list's cache key: decisions and task changes refresh it (lib/task-cache). */
export const APPROVALS_KEY = ['approvals'] as const;

/**
 * The tasks waiting for the signed-in person's approval, oldest first, and whether they approve any
 * project's tasks (GET /tasks/approvals) — My Tasks' To approve and the Dashboard's Approvals card.
 * Read through the person's offline copy, so it opens without signal; asked again after 30 s.
 */
export function useApprovals(): UseQueryResult<ApprovalsAnswer> {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: APPROVALS_KEY,
    queryFn: ({ queryKey }) => reads.read(queryKey, 'approvals', () => resources.tasks.approvals()),
    staleTime: 30_000,
  });
}

type TaskVersion = Pick<ApiTask, 'id' | 'version'>;

/**
 * Approve, Send back and the "Needs approval" switch — online only, never kept on the phone: each is
 * sent at once, as the person who made it, from the version on screen (a change made meanwhile is
 * refused). The server's answer is laid over the task and what it changed is refreshed; a refusal
 * reloads the task, so a retry is from what is there now. Errors go back to the caller, which says
 * them (failureText: offline, or the server's own sentence).
 */
export function useApprovalActions(): {
  approve(t: TaskVersion): Promise<ApiTask>;
  sendBack(t: TaskVersion, reason: string): Promise<ApiTask>;
  setNeedsApproval(t: TaskVersion, on: boolean): Promise<ApiTask>;
} {
  const services = useServices();
  const qc = useQueryClient();
  return useMemo(() => {
    const decide = (t: TaskVersion, send: (r: ResourcesApi) => Promise<ApiTask>): Promise<ApiTask> =>
      owned(services)
        .run(send)
        .then(
          (answer) => {
            afterApprovalDecision(qc, t.id, answer);
            return answer;
          },
          (e: unknown) => {
            if (!isNetworkError(e)) afterApprovalRefused(qc, t.id);
            throw e;
          },
        );
    return {
      approve: (t) => decide(t, (r) => r.tasks.approve(t.id, t.version)),
      sendBack: (t, reason) => decide(t, (r) => r.tasks.sendBack(t.id, reason, t.version)),
      setNeedsApproval: (t, on) => decide(t, (r) => r.tasks.update(t.id, { needsApproval: on, expectedVersion: t.version })),
    };
  }, [services, qc]);
}
