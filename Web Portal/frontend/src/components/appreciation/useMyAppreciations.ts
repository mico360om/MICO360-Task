import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { appreciationsApi, APPRECIATIONS_ME_KEY, type ApiAppreciation, type ApiAppreciationsMe } from '../../api/appreciations';
import { ApiError } from '../../lib/api-client';
import { enqueueOffline, queuedAppreciationAccepts } from '../../lib/offline-replay';
import { useAuthStore } from '../../stores/auth-store';

const api = appreciationsApi(apiClient);

/**
 * What this page did and the server may not have answered yet (a read that was already on its way when the person
 * pressed Accept or Close would otherwise bring the popup back): kept for the life of the page.
 */
const acceptedHere = new Map<string, string>();
const closedHere = new Map<string, string>();
/** Forget them (tests; a new sign-in starts clean because the keys carry the person's id). */
export function forgetLocalAppreciations(): void {
  acceptedHere.clear();
  closedHere.clear();
}

/**
 * Employee Appreciation (1.24.0): the signed-in person's appreciations today, from the server (never the browser):
 * read on load, every 10 minutes, when the window is focused again and when the connection comes back — so the
 * theme goes away by itself soon after midnight (company time). An Accept made offline is in the offline queue
 * and shows as accepted at once (also after a reload) until it is sent.
 */
export function useMyAppreciations() {
  const user = useAuthStore((s) => s.user);
  const staff = !!user && !(user.roles ?? []).includes('CLIENT');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: APPRECIATIONS_ME_KEY,
    queryFn: () => api.me(),
    enabled: staff,
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  // Bumped when an accept is queued offline, so the overlay below is read again.
  const [queuedTick, setQueuedTick] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const live: ApiAppreciation[] = useMemo(() => {
    void queuedTick;
    const queued = queuedAppreciationAccepts();
    const now = new Date().toISOString();
    return (q.data?.live ?? []).map((a) => {
      let v = a;
      const key = `${user?.id}:${v.id}`;
      if (!v.acceptedAt && (queued.has(v.id) || acceptedHere.has(key))) v = { ...v, acceptedAt: acceptedHere.get(key) ?? now, status: 'ACCEPTED' as const };
      if (!v.popupClosedAt && closedHere.has(key)) v = { ...v, popupClosedAt: closedHere.get(key)! };
      return v;
    });
  }, [q.data, queuedTick, user?.id]);

  const patch = useCallback(
    (id: string, change: Partial<ApiAppreciation>) =>
      qc.setQueryData<ApiAppreciationsMe>(APPRECIATIONS_ME_KEY, (old) => (old ? { ...old, live: old.live.map((a) => (a.id === id ? { ...a, ...change } : a)) } : old)),
    [qc],
  );

  /** Accept: shown at once; sent now, or queued when there is no connection. */
  const accept = useCallback(
    async (id: string): Promise<boolean> => {
      setProblem(null);
      const before = q.data?.live.find((a) => a.id === id);
      const at = new Date().toISOString();
      acceptedHere.set(`${user?.id}:${id}`, at);
      await qc.cancelQueries({ queryKey: APPRECIATIONS_ME_KEY });
      patch(id, { acceptedAt: at, status: 'ACCEPTED' });
      try {
        const r = await api.accept(id);
        patch(id, { acceptedAt: r.acceptedAt, status: 'ACCEPTED' });
        return true;
      } catch (e) {
        if (!(e instanceof ApiError) && enqueueOffline('appreciation.accept', { id })) {
          // The queue now says accepted (until it is sent — or refused, which then shows it as not accepted).
          acceptedHere.delete(`${user?.id}:${id}`);
          setQueuedTick((n) => n + 1);
          return true;
        }
        acceptedHere.delete(`${user?.id}:${id}`);
        if (before) patch(id, { acceptedAt: before.acceptedAt, status: before.status });
        setProblem(e instanceof Error && e.message ? e.message : 'The appreciation could not be accepted. Please try again.');
        void qc.invalidateQueries({ queryKey: APPRECIATIONS_ME_KEY });
        return false;
      }
    },
    [patch, q.data, qc, user?.id],
  );

  /** Close the popup without accepting: it never comes back (the server keeps it closed for every device). */
  const closePopup = useCallback(
    async (id: string) => {
      const at = new Date().toISOString();
      closedHere.set(`${user?.id}:${id}`, at);
      await qc.cancelQueries({ queryKey: APPRECIATIONS_ME_KEY });
      patch(id, { popupClosedAt: at });
      try {
        await api.closePopup(id);
      } catch {
        /* offline: closed on this page; the banner still offers Accept */
      }
    },
    [patch, qc, user?.id],
  );

  return { query: q, data: q.data, live, accept, closePopup, problem, clearProblem: () => setProblem(null) };
}
