import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import type { ClientShare } from '../lib/client-share';
import { refresh } from '../lib/refresh';
import type { ApiTask } from '../lib/types';

/**
 * Sharing a project with its client (Stage 4): the clients a project is shared with, and adding,
 * re-sending and removing one — online, as on the website (whoever runs the project; the server
 * checks too). Each change reads the list again.
 */
export function useClientShares(projectId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['client-shares', projectId], queryFn: () => resources.clientShares.list(projectId) });
}

export function useShareMutations(projectId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client-shares', projectId] });
  // Add sends the form's key, so a retried Share never invites them twice.
  const add = useMutation({
    mutationFn: ({ input, key }: { input: { name: string; email: string }; key: string }) => resources.clientShares.add(projectId, input, key),
    onSuccess: refresh,
  });
  const resend = useMutation({ mutationFn: (share: ClientShare) => resources.clientShares.resend(projectId, share.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (share: ClientShare) => resources.clientShares.remove(projectId, share.id), onSuccess: refresh });
  return { add, resend, remove };
}

/**
 * "Show to client" on a task (whoever runs its project): the server's answer is laid over the task
 * shown at once, then the lists holding it (its eye mark) and its history are read again.
 */
export function useTaskClientVisible(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visible: boolean) => resources.clientShares.setTaskVisible(taskId, visible),
    onSuccess: (answer, visible) => {
      qc.setQueryData<ApiTask>(['task', taskId], (old) => (old ? { ...old, clientVisible: answer.clientVisible ?? visible } : old));
      refresh(qc, [{ listsHolding: taskId }, { queryKey: ['task', taskId, 'activity'], exact: true }]);
    },
  });
}
