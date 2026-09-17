import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, assetUrl } from '../api/client';
import { usersApi } from '../api/users';
import { useAuthStore } from '../stores/auth-store';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { FieldLabel, fieldClass } from '../components/ui/Field';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-0">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="truncate text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Self-service password change — verifies the current password server-side. */
function ChangePasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mut = useMutation({
    mutationFn: () => usersApi(apiClient).changePassword(current, next),
    onSuccess: () => {
      setCurrent(''); setNext(''); setConfirm('');
      setError(null); setDone(true);
    },
    onError: () => { setDone(false); setError('Couldn’t change your password. Check that your current password is correct.'); },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (!current || next.length < 6) { setError('Enter your current password and a new one of at least 6 characters.'); return; }
    if (next !== confirm) { setError('The new passwords don’t match.'); return; }
    setError(null);
    mut.mutate();
  }

  return (
    <section className="card p-6">
      <h3 className="eyebrow mb-1">Change password</h3>
      <p className="mb-3 text-sm text-ink-2">Update the password you use to sign in.</p>
      {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      {done ? <p role="status" className="mb-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">Password changed.</p> : null}
      <form onSubmit={submit} className="flex flex-col gap-3 sm:max-w-sm">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="cp-current" required>Current password</FieldLabel>
          <input id="cp-current" type="password" value={current} onChange={(e) => { setCurrent(e.target.value); setDone(false); }} autoComplete="current-password" className={fieldClass(false)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="cp-new" required>New password</FieldLabel>
          <input id="cp-new" type="password" value={next} onChange={(e) => { setNext(e.target.value); setDone(false); }} autoComplete="new-password" className={fieldClass(false)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="cp-confirm" required>Confirm new password</FieldLabel>
          <input id="cp-confirm" type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setDone(false); }} autoComplete="new-password" className={fieldClass(false)} />
        </div>
        <Button type="submit" loading={mut.isPending} className="self-start">
          {mut.isPending ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </section>
  );
}

export function ProfilePage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const logout = useAuthStore((s) => s.logout);

  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const me = Array.isArray(dirQ.data) ? dirQ.data.find((d) => d.id === user?.id) : undefined;
  const fullName = me ? `${me.firstName} ${me.lastName}`.trim() || me.username : (user?.username ?? '—');
  const isAdmin = (user?.roles ?? []).includes('ADMIN');
  const initials = (fullName || user?.username || '?').slice(0, 2).toUpperCase();

  const avatarRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function applyUpdatedUser(updated: { id: string; email: string; username: string; roles: string[]; avatarUrl: string | null }) {
    const { accessToken, refreshToken } = useAuthStore.getState();
    if (accessToken && refreshToken) {
      setSession({
        user: { id: updated.id, email: updated.email, username: updated.username, roles: updated.roles, avatarUrl: updated.avatarUrl },
        accessToken,
        refreshToken,
      });
    }
    void qc.invalidateQueries({ queryKey: ['users'] });
  }
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      applyUpdatedUser(await usersApi(apiClient).uploadAvatar(file));
    } finally {
      setBusy(false);
    }
  }
  async function onRemove() {
    setBusy(true);
    try {
      applyUpdatedUser(await usersApi(apiClient).removeAvatar());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Account" title="Your profile" subtitle="Your photo, identity and account details." />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Identity card */}
        <section className="card flex flex-col items-center gap-3 p-6 text-center">
          <div className="relative">
            {user?.avatarUrl ? (
              <img src={assetUrl(user.avatarUrl)} alt={fullName} className="h-28 w-28 rounded-full border border-line object-cover shadow-soft" />
            ) : (
              <span className="grid h-28 w-28 place-items-center rounded-full bg-brand-gradient text-3xl font-bold text-white shadow-brand">{initials}</span>
            )}
            <button
              type="button"
              onClick={() => avatarRef.current?.click()}
              disabled={busy}
              aria-label="Change photo"
              title="Change photo"
              className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
            <input ref={avatarRef} type="file" accept="image/*" hidden onChange={onPick} />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-ink">{fullName}</h2>
            <p className="text-sm text-ink-2">@{user?.username}</p>
          </div>
          <Badge tone={isAdmin ? 'brand' : 'neutral'}>{isAdmin ? 'Administrator' : 'Employee'}</Badge>
          <div className="flex items-center gap-3 text-xs">
            <button type="button" onClick={() => avatarRef.current?.click()} disabled={busy} className="font-semibold text-brand hover:underline disabled:opacity-50">
              {busy ? 'Uploading…' : user?.avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {user?.avatarUrl ? (
              <button type="button" onClick={onRemove} disabled={busy} className="text-ink-2 hover:text-danger hover:underline disabled:opacity-50">
                Remove
              </button>
            ) : null}
          </div>
        </section>

        {/* Details + actions */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <section className="card p-6">
            <h3 className="eyebrow mb-2">Account details</h3>
            <dl>
              <Row label="Full name" value={fullName} />
              <Row label="Username" value={user?.username ?? '—'} />
              <Row label="Email" value={user?.email ?? '—'} />
              <Row label="Role" value={isAdmin ? 'Administrator' : 'Employee'} />
            </dl>
          </section>

          <ChangePasswordCard />

          <section className="card p-6">
            <h3 className="eyebrow mb-3">Account</h3>
            <div className="flex flex-wrap gap-2">
              <Link to="/settings" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand">
                Preferences & notifications
              </Link>
              <Link to="/settings" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand">
                Appearance
              </Link>
              <button
                onClick={logout}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:border-danger/40 hover:bg-danger-soft"
              >
                Sign out
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
