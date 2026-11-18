import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { TWO_STEP_KEY, twoStepApi, type TwoStepStatus } from '../../api/two-step';
import { useAuthStore } from '../../stores/auth-store';
import { ConfirmDialog } from '../ui/ConfirmDialog';

/**
 * 1.24 two-step sign-in for administrators (Manager View too: it is their own sign-in). Settings →
 * Security says whether it is on, how many browsers are trusted (and until when this one is), and offers
 * "Forget all trusted browsers" — every browser then asks for a code at its next sign-in; this page stays
 * signed in. The red banner on every page says when it is off on the server.
 */
const useIsAdmin = () => useAuthStore((s) => (s.user?.roles ?? []).includes('ADMIN'));

function useTwoStep(enabled: boolean) {
  return useQuery({ queryKey: TWO_STEP_KEY, queryFn: () => twoStepApi(apiClient).status(), enabled, staleTime: 5 * 60_000 });
}

const dayMonth = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

function stateWords(s: TwoStepStatus): string {
  if (s.on) return 'On (code by email)';
  return s.reason === 'email-not-set-up' ? 'Off (email isn’t set up on the server)' : 'Off (switched off on the server)';
}

export function TwoStepSettings() {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const q = useTwoStep(isAdmin);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const forget = useMutation({
    mutationFn: () => twoStepApi(apiClient).forgetAll(),
    onSuccess: async () => {
      setAsking(false);
      setDone(true);
      await qc.invalidateQueries({ queryKey: TWO_STEP_KEY });
    },
  });
  if (!isAdmin) return null;
  const s = q.data;
  return (
    <div data-two-step className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">
            Two-step sign-in: <span className={s && !s.on ? 'text-danger' : ''}>{s ? stateWords(s) : q.isError ? 'couldn’t be read' : '…'}</span>
          </div>
          {s ? (
            <div className="text-xs text-ink-2">
              <span>Trusted browsers: {s.trustedBrowsers}</span>
              {s.thisBrowserTrustedUntil ? <span> · This browser is trusted until {dayMonth(s.thisBrowserTrustedUntil)}</span> : null}
            </div>
          ) : null}
          <div className="text-xs text-ink-2">Administrators confirm each new browser with a code we email. A trusted browser asks again after 30 days.</div>
        </div>
        {s && s.trustedBrowsers > 0 ? (
          <button
            type="button"
            onClick={() => {
              setDone(false);
              setAsking(true);
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-ground [@media(pointer:coarse)]:min-h-11"
          >
            Forget all trusted browsers
          </button>
        ) : null}
      </div>
      {done ? (
        <p role="status" className="mt-2 text-xs text-ink-2">
          Done. Every browser will ask for a code at its next sign-in.
        </p>
      ) : null}
      {asking ? (
        <ConfirmDialog
          title="Forget all trusted browsers?"
          confirmLabel="Forget all"
          keepLabel="Cancel"
          tone="primary"
          busy={forget.isPending}
          error={forget.isError ? 'Couldn’t forget them. Please try again.' : null}
          onConfirm={() => forget.mutate()}
          onClose={() => setAsking(false)}
        >
          Every browser, this one too, will ask for a code at its next sign-in. You stay signed in here.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** The red banner above every page for administrators while two-step sign-in is off on the server. */
export function TwoStepOffBanner({ frameClass = '' }: { frameClass?: string }) {
  const isAdmin = useIsAdmin();
  const s = useTwoStep(isAdmin).data;
  if (!isAdmin || !s || s.on !== false) return null;
  return (
    <div className={frameClass}>
      <div role="status" data-two-step-off className="mt-3 flex items-start gap-3 rounded-xl border border-danger/50 bg-danger-soft px-3 py-2 text-sm text-ink">
        <svg className="mt-0.5 flex-none text-danger" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
          <path d="M12 8v5M12 16.5v.01" />
        </svg>
        <p className="min-w-0 flex-1">
          {s.reason === 'email-not-set-up' ? (
            <>
              <strong className="font-semibold text-danger">Two-step sign-in is off: email isn’t set up on the server.</strong> Administrators sign in with their password alone until email works.
            </>
          ) : (
            <>
              <strong className="font-semibold text-danger">Two-step sign-in is switched off on the server.</strong> Remove ADMIN_TWO_STEP=off from the server’s environment variables to switch it back on.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
