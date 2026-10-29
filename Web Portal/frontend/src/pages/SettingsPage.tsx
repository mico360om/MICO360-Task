import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth-store';
import { useSignOut } from '../lib/useSignOut';
import { SignOutWarning } from '../components/SignOutWarning';
import { PageHeader } from '../components/ui/PageHeader';
import { apiClient, assetUrl } from '../api/client';
import { notificationsApi, type NotificationPreferences } from '../api/notifications';
import { usersApi } from '../api/users';
import { useThemeChoice, type ThemeChoice } from '../lib/theme';
import { DatePreferences } from '../components/DatePreferences';
import { LoadError } from '../components/ui/LoadError';
import { photoUploadProblem } from '../lib/photo-upload';
import { Toggle } from '../components/ui/Toggle';
import { DailyEmailSettings } from '../components/settings/DailyEmailSettings';
import { WeeklySummarySettings } from '../components/settings/WeeklySummarySettings';

const NOTIF_TYPES: { type: string; label: string; desc: string }[] = [
  { type: 'TASK_ASSIGNED', label: 'Task assignments', desc: 'When a task is assigned to you' },
  { type: 'TASK_STATUS', label: 'Status changes', desc: 'When one of your tasks moves column' },
  { type: 'TASK_COMMENT', label: 'Comments', desc: 'New comments on tasks you’re on' },
  { type: 'MENTION', label: 'Mentions', desc: 'When someone @mentions you' },
  { type: 'TASK_DUE_SOON', label: 'Due soon', desc: 'A reminder shortly before a task is due' },
  { type: 'TASK_OVERDUE', label: 'Overdue', desc: 'When one of your tasks becomes overdue' },
  { type: 'PROJECT_ADDED', label: 'Added to a project', desc: 'When someone puts you on a project’s team or makes you its owner' },
];

const THEME_OPTIONS: ThemeChoice[] = ['light', 'dark', 'system'];

/** "Remind me before a task is due" presets (minutes). `null` = the workspace default. */
const LEAD_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Default (1 day)', value: null },
  { label: 'At due time', value: 0 },
  { label: '1 hour before', value: 60 },
  { label: '4 hours before', value: 240 },
  { label: '1 day before', value: 1440 },
  { label: '2 days before', value: 2880 },
  { label: '1 week before', value: 10080 },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  // Every sign-out asks first when changes are still on this device (see useSignOut).
  const { signOut, unsent, cancel } = useSignOut();
  const [theme, setTheme] = useThemeChoice();

  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // "Keep me signed in": the session survives a browser restart; otherwise it ends with this window.
  const remembered = useAuthStore((st) => st.remember);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const setSession = useAuthStore((s) => s.setSession);
  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    setPhotoProblem(null);
    try {
      const updated = await usersApi(apiClient).uploadAvatar(file);
      const { accessToken, refreshToken } = useAuthStore.getState();
      if (accessToken && refreshToken) {
        setSession({
          user: { id: updated.id, email: updated.email, username: updated.username, roles: updated.roles, avatarUrl: updated.avatarUrl },
          accessToken,
          refreshToken,
        });
      }
      void qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      // A refused file (not a picture, too large) must say so — it used to change nothing, silently.
      setPhotoProblem(photoUploadProblem(err));
    } finally {
      setAvatarBusy(false);
    }
  }
  async function onAvatarRemove() {
    setAvatarBusy(true);
    setPhotoProblem(null);
    try {
      const updated = await usersApi(apiClient).removeAvatar();
      const { accessToken, refreshToken } = useAuthStore.getState();
      if (accessToken && refreshToken) {
        setSession({
          user: { id: updated.id, email: updated.email, username: updated.username, roles: updated.roles, avatarUrl: updated.avatarUrl },
          accessToken,
          refreshToken,
        });
      }
      void qc.invalidateQueries({ queryKey: ['users'] });
    } catch {
      setPhotoProblem('Couldn’t remove the photo. Please try again.');
    } finally {
      setAvatarBusy(false);
    }
  }

  const prefsQ = useQuery({ queryKey: ['notification-prefs'], queryFn: () => notificationsApi(apiClient).getPreferences() });
  const prefs = prefsQ.data ?? { muted: [] };
  const muted = prefs.muted ?? [];

  const setMut = useMutation({
    // Only the muted types and the reminder time (the server saves them together and keeps the rest),
    // so a tab opened earlier can never send back an old daily email or weekly summary choice.
    mutationFn: (next: { muted: string[]; reminderLeadMinutes?: number }) => notificationsApi(apiClient).setPreferences(next),
    onMutate: async (next) => {
      setSaveProblem(null);
      await qc.cancelQueries({ queryKey: ['notification-prefs'] });
      const prev = qc.getQueryData<NotificationPreferences>(['notification-prefs']);
      qc.setQueryData<NotificationPreferences>(['notification-prefs'], { ...prev, ...next });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notification-prefs'], ctx.prev);
      // The switch goes back to what is stored — say why, or it looks like a glitch.
      setSaveProblem('Couldn’t save that change. Please try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notification-prefs'] }),
  });

  function toggle(type: string) {
    const isOn = !muted.includes(type);
    setMut.mutate({ muted: isOn ? [...muted, type] : muted.filter((t) => t !== type), reminderLeadMinutes: prefs.reminderLeadMinutes });
  }
  function setLead(minutes: number | undefined) {
    setMut.mutate({ muted, reminderLeadMinutes: minutes });
  }

  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();

  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Settings" subtitle="Your profile and personal preferences." />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profile */}
        <section className="card p-5">
          <h2 className="eyebrow mb-4">Profile</h2>
          <div className="mb-4 flex items-center gap-4">
            {user?.avatarUrl ? (
              <img src={assetUrl(user.avatarUrl)} alt={user.username} className="h-14 w-14 rounded-2xl border border-line object-cover" />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient text-lg font-bold text-white shadow-brand">
                {initials}
              </span>
            )}
            <div className="min-w-0">
              <div className="text-lg font-semibold text-ink">{user?.username ?? '—'}</div>
              <div className="text-sm text-ink-2">{user?.roles?.includes('ADMIN') ? 'Administrator' : 'Employee'}</div>
              <div className="mt-1 flex items-center gap-3">
                <input ref={avatarRef} type="file" accept="image/*" hidden onChange={onAvatarPick} />
                <button
                  type="button"
                  onClick={() => avatarRef.current?.click()}
                  disabled={avatarBusy}
                  className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
                >
                  {avatarBusy ? 'Uploading…' : user?.avatarUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {user?.avatarUrl ? (
                  <button type="button" onClick={onAvatarRemove} disabled={avatarBusy} className="text-xs text-ink-2 hover:text-danger hover:underline disabled:opacity-50">
                    Remove
                  </button>
                ) : null}
              </div>
              {photoProblem ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{photoProblem}</p> : null}
            </div>
          </div>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between border-t border-line pt-3">
              <dt className="text-ink-2">Username</dt>
              <dd className="font-medium text-ink">{user?.username ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3">
              <dt className="text-ink-2">Email</dt>
              <dd className="font-medium text-ink">{user?.email ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3">
              <dt className="text-ink-2">Role</dt>
              <dd className="font-medium text-ink">{user?.roles?.includes('ADMIN') ? 'Administrator' : 'Employee'}</dd>
            </div>
          </dl>
        </section>

        {/* Notifications */}
        <section className="card p-5">
          <h2 className="eyebrow mb-4">Notifications</h2>
          {saveProblem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{saveProblem}</p> : null}
          {prefsQ.isError ? (
            <LoadError what="your notification preferences" onRetry={() => void prefsQ.refetch()} />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {NOTIF_TYPES.map((n) => {
                const on = !muted.includes(n.type);
                return (
                  <li key={n.type} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{n.label}</div>
                      <div className="text-xs text-ink-2">{n.desc}</div>
                    </div>
                    <Toggle on={on} onChange={() => toggle(n.type)} label={`Notify me: ${n.label}`} />
                  </li>
                );
              })}
            </ul>
          )}
          {!prefsQ.isError ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div>
                <div className="text-sm font-medium text-ink">Remind me before due</div>
                <div className="text-xs text-ink-2">How early a “due soon” reminder is sent for your tasks.</div>
              </div>
              <select
                aria-label="Reminder timing"
                value={prefs.reminderLeadMinutes ?? ''}
                onChange={(e) => setLead(e.target.value === '' ? undefined : Number(e.target.value))}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                {LEAD_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ''}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </section>

        {/* Daily task emails */}
        <DailyEmailSettings />

        <WeeklySummarySettings />

        {/* Appearance */}
        <section className="card p-5 lg:col-span-2">
          <h2 className="eyebrow mb-4">Appearance</h2>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-ink">Theme</div>
              <div className="text-xs text-ink-2">Choose light, dark, or match your system.</div>
            </div>
            <div role="group" aria-label="Theme" className="inline-flex rounded-lg border border-line p-0.5">
              {THEME_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  aria-pressed={theme === t}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors [@media(pointer:coarse)]:!min-h-11 ${
                    theme === t ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Calendar & dates */}
        <section className="card p-5 lg:col-span-2">
          <h2 className="eyebrow mb-4">Calendar &amp; dates</h2>
          <DatePreferences />
        </section>

        {/* Security & session */}
        <section className="card p-5 lg:col-span-2">
          <h2 className="eyebrow mb-4">Security &amp; session</h2>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              {remembered ? (
                <>
                  <div className="text-sm font-medium text-ink">You’re signed in for 30 days</div>
                  <div className="text-xs text-ink-2">Your session refreshes silently, so you won’t be asked to sign in again for a month.</div>
                </>
              ) : (
                <>
                  <div className="text-sm font-medium text-ink">You’re signed in until you close this browser</div>
                  <div className="text-xs text-ink-2">“Keep me signed in” was not ticked, so you’ll sign in again next time.</div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/profile"
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:bg-ground"
              >
                Change password
              </Link>
              <button
                onClick={() => signOut()}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger-soft"
              >
                Sign out
              </button>
            </div>
            {unsent !== null ? <SignOutWarning unsent={unsent} onConfirm={() => signOut({ force: true })} onCancel={cancel} className="mt-3" /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
