import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { useDebouncedValue } from './useDebounced';
import { refresh } from '../lib/refresh';
import { putRow } from '../lib/meeting-cache';
import { addInTurn, readFreeTimes } from '../lib/meeting-ai';
import { pendingKeys, tryName } from '../lib/pending-keys';
import type { AiAgendaItem, AiDraftAgendaInput, ApiAgendaItem, FreeTimesInput } from '../lib/types';

/**
 * The meeting AI helpers and free times (2c). The AI helpers are suggestions the person reviews
 * before anything changes; they need a connection and are never kept offline. Free times are
 * worked out by the server (no AI).
 */

/** "Describe the meeting": what the sentence fills in (today = the company's day). */
export function useParseMeeting() {
  const { resources } = useServices();
  return useMutation({ mutationFn: ({ text, today }: { text: string; today: string }) => resources.ai.parseMeeting(text, today) });
}

/** "Write description". */
export function useWriteMeetingDescription() {
  const { resources } = useServices();
  return useMutation({ mutationFn: (input: { title: string; agenda?: string[]; text?: string }) => resources.ai.writeMeetingDescription(input) });
}

/** "Draft agenda": the AI's proposal, to review before anything is added. */
export function useDraftAgenda() {
  const { resources } = useServices();
  return useMutation({ mutationFn: (input: AiDraftAgendaInput) => resources.ai.draftAgenda(input) });
}

/**
 * Free times for what the form holds — checked again once the time, length, repeat or people have
 * settled for 400 ms (not on each keystroke). Not kept: it is only true for now.
 */
export function useFreeTimes(input: FreeTimesInput | null, enabled = true) {
  const { resources } = useServices();
  const key = useDebouncedValue(input ? JSON.stringify(input) : '', 400);
  return useQuery({
    queryKey: ['meeting-free-times', key],
    queryFn: async () => {
      const reply = readFreeTimes(await resources.meetings.freeTimes(JSON.parse(key) as FreeTimesInput));
      if (!reply) throw new Error('Unexpected answer');
      return reply;
    },
    enabled: enabled && !!key,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
  });
}

/**
 * The drafted agenda's ticked items added to a meeting, one after another. Each goes with a key kept
 * while its try gets no answer (pending-keys), so a second try after a time-out adds it once; on a
 * failure the result says which items are left.
 */
export function useAddDraftedAgenda(meetingId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const key = ['meeting', meetingId, 'agenda'];
  return useMutation({
    mutationFn: (items: AiAgendaItem[]) =>
      addInTurn(items, async (item) => {
        const input = { title: item.title.trim().slice(0, 300), ownerId: item.ownerId ?? null, expectedMinutes: item.minutes > 0 ? Math.min(600, Math.round(item.minutes)) : null };
        const what = tryName('agenda', meetingId, input);
        try {
          const row = await resources.meetings.addAgendaItem(meetingId, input, { idempotencyKey: pendingKeys.keyFor(what) });
          pendingKeys.settle(what);
          if (row?.id) putRow<ApiAgendaItem>(qc, key, row);
          return row;
        } catch (e) {
          pendingKeys.settle(what, e);
          throw e;
        }
      }),
    // What was added shows at once; the agenda is loaded again for the server's order.
    onSettled: () => refresh(qc, [{ queryKey: key, exact: true }, { queryKey: ['meetings'], later: true }]),
  });
}
