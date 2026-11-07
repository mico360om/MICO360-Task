import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { configApi } from '../../api/config';
import { CLIENTS_KEY } from '../../api/clients';
import { usersApi, type ApiUser } from '../../api/users';
import { ApiError } from '../../lib/api-client';
import { invitedText, lifetimeText, statusOf, temporaryPasswordText } from '../../lib/onboarding';
import { signInText } from '../../lib/user-sign-in';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../ui/Button';
import { OnboardingStatusCell } from './OnboardingCells';
import { LifetimeSelect, useInvitationDays } from './way-in';
import { FieldLabel } from '../ui/Field';

const SECTION = 'mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2';

/** The server's own words for a refusal, else `fallback`. */
function said(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 600 && err.message && !/^Request failed/.test(err.message)) return err.message;
  return fallback;
}

/**
 * Onboarding, in Manage account (staff and clients alike): where the account stands — Invited /
 * Invite expired / Active / Locked / Deactivated, email verified or not, last sign-in — and what an
 * administrator can do about it: send (or resend) the invitation, send a password reset link (valid
 * an hour), or mark the email address as verified by hand, with a reason (when a code can't reach them).
 * 1.23.6: the invitation's lifetime, Cancel invitation (no way in until a new one), and when a
 * temporary password was set and by whom (never the password).
 */
export function SignInSection({ user }: { user: ApiUser }) {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const timeZone = useCompanyTimeZone();
  const id = useId();
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const emailEnabled = (configQ.data as { emailEnabled?: unknown } | undefined)?.emailEnabled !== false;
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [reason, setReason] = useState('');
  const [verifiedNow, setVerifiedNow] = useState(false);
  const status = statusOf(user);
  const deactivated = status === 'DEACTIVATED';
  const self = user.id === meId;
  const invited = !!(user.invitedAt ?? user.welcomeSentAt);
  const settingDays = useInvitationDays();
  const [chosenDays, setChosenDays] = useState<number | null>(null);
  const days = chosenDays ?? settingDays;
  const neverSignedIn = !user.lastLoginAt && !user.activatedAt;
  const cancelled = !!user.invitationCancelledAt;
  // Cancel invitation: someone who hasn't signed in yet and has a way in waiting (a link or a temporary password).
  const canCancel = neverSignedIn && !cancelled && (invited || !!user.mustChangePassword);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: CLIENTS_KEY });
  };

  const inviteMut = useMutation({
    mutationFn: () => usersApi(apiClient).sendWelcome(user.id, days),
    onMutate: () => setNotice(null),
    onSuccess: (out) => {
      setNotice({ text: `Invitation ${invited ? 'resent' : 'sent'} to ${out.email ?? user.email}. The link works for ${lifetimeText(days)}; any earlier one (and an unused temporary password) stops working.` });
      refresh();
    },
    onError: (err) => setNotice({ text: said(err, 'Couldn’t send the invitation. Try again.'), error: true }),
  });
  const cancelMut = useMutation({
    mutationFn: () => usersApi(apiClient).cancelInvitation(user.id),
    onMutate: () => setNotice(null),
    onSuccess: () => {
      setNotice({ text: 'Invitation cancelled. They can’t get in — no link, Forgot password or emailed code — until you send a new invitation or set a temporary password.' });
      refresh();
    },
    onError: (err) => setNotice({ text: said(err, 'Couldn’t cancel the invitation. Try again.'), error: true }),
  });
  const resetMut = useMutation({
    mutationFn: () => usersApi(apiClient).sendPasswordReset(user.id),
    onMutate: () => setNotice(null),
    onSuccess: (out) => setNotice({ text: `Password reset link sent to ${out.email ?? user.email}. It works for an hour; their sign-ins stay until they set the new password.` }),
    onError: (err) => setNotice({ text: said(err, 'Couldn’t send the reset link. Try again.'), error: true }),
  });
  const verifyMut = useMutation({
    mutationFn: () => usersApi(apiClient).markEmailVerified(user.id, reason.trim()),
    onMutate: () => setNotice(null),
    onSuccess: () => {
      setVerifying(false);
      setReason('');
      setVerifiedNow(true);
      setNotice({ text: 'Email address marked as verified. The reason is in the audit log.' });
      refresh();
    },
    onError: (err) => setNotice({ text: said(err, 'Couldn’t mark the email as verified. Try again.'), error: true }),
  });

  const verified = verifiedNow || !!user.emailVerifiedAt;
  const shown: ApiUser = verifiedNow ? { ...user, emailVerifiedAt: new Date().toISOString() } : user;
  const invitedLine = invitedText(user, timeZone);
  const offEmail = !emailEnabled ? `${id}-email-off` : undefined;
  const busy = inviteMut.isPending || resetMut.isPending || verifyMut.isPending || cancelMut.isPending;
  const tempLine = temporaryPasswordText(user, timeZone);

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2 border-t border-line pt-4">
      <p id={`${id}-title`} className={SECTION}>Sign-in &amp; email</p>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-lg border border-line p-3">
        <OnboardingStatusCell person={shown} />
        <dl className="grid min-w-0 gap-0.5 text-xs text-ink-2">
          <div><dt className="inline">Last sign-in: </dt><dd className="inline text-ink">{signInText(user.lastLoginAt, timeZone)}</dd></div>
          {invitedLine ? <div><dd>{invitedLine}</dd></div> : null}
          {tempLine ? <div><dd data-temporary-password-line>{tempLine}</dd></div> : null}
        </dl>
      </div>
      {notice ? (
        <p role={notice.error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          {notice.text}
        </p>
      ) : null}
      {!emailEnabled ? (
        <p id={offEmail} className="text-xs text-ink-2">Email isn’t set up on this server, so invitations and reset links can’t be sent. Set a temporary password below instead.</p>
      ) : null}
      {emailEnabled && !deactivated && !self ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`${id}-days`}>Invitation link works for</FieldLabel>
            <LifetimeSelect id={`${id}-days`} value={days} onChange={setChosenDays} disabled={busy} />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => inviteMut.mutate()} disabled={!emailEnabled || deactivated || self || busy} loading={inviteMut.isPending} aria-describedby={offEmail} className="[@media(pointer:coarse)]:!min-h-11">
          {invited ? 'Resend invitation' : 'Send invitation'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => resetMut.mutate()} disabled={!emailEnabled || deactivated || busy} loading={resetMut.isPending} aria-describedby={offEmail} className="[@media(pointer:coarse)]:!min-h-11">
          Send password reset
        </Button>
        {canCancel && !self && !deactivated ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => cancelMut.mutate()} disabled={busy} loading={cancelMut.isPending} className="[@media(pointer:coarse)]:!min-h-11">
            Cancel invitation
          </Button>
        ) : null}
        {!verified && !self && !verifying ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setVerifying(true)} disabled={busy} className="[@media(pointer:coarse)]:!min-h-11">
            Mark email as verified…
          </Button>
        ) : null}
      </div>
      {deactivated ? <p className="text-xs text-ink-2">The account is deactivated: reactivate it before sending anything.</p> : null}
      {cancelled && neverSignedIn && !deactivated ? (
        <p className="text-xs text-ink-2">The invitation is cancelled: no way in works until you send a new invitation or set a temporary password.</p>
      ) : null}
      {verifying ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium text-ink">Why is this address right?</label>
          <p id={`${id}-reason-hint`} className="text-xs text-ink-2">
            For when our code can’t reach them (a mail outage, a blocked address). They won’t be asked for a code at sign-in. Kept in the audit log.
          </p>
          <textarea
            id={`${id}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            rows={2}
            maxLength={300}
            aria-describedby={`${id}-reason-hint`}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => verifyMut.mutate()} disabled={!reason.trim()} loading={verifyMut.isPending} className="[@media(pointer:coarse)]:!min-h-11">
              Mark as verified
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setVerifying(false); setReason(''); }} className="[@media(pointer:coarse)]:!min-h-11">
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {!verified && self ? <p className="text-xs text-ink-2">Your own address is confirmed with a code at sign-in, or by another administrator.</p> : null}
    </section>
  );
}
