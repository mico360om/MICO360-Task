import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { notificationsApi, type NotificationPreferences, type NotificationPreferencesSave, type PersonQuietHours } from '../../api/notifications';
import { notificationSettingsApi, PERSON_POLICY_KEY, type Channels, type PersonPolicy, type PolicyKind } from '../../api/notification-settings';
import { LoadError } from '../ui/LoadError';
import { Toggle } from '../ui/Toggle';
import { Button } from '../ui/Button';
import { KIND_WORDS, momentText, pauseChoices, workingDaysText } from '../../lib/notify-kinds';

export const PREFS_KEY = ['notification-prefs'] as const;

/** "Remind me before due": one extra "due soon" reminder for the person's own tasks. `null` = none of their own. */
const LEAD_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No extra reminder', value: null },
  { label: 'At due time', value: 0 },
  { label: '1 hour before', value: 60 },
  { label: '4 hours before', value: 240 },
  { label: '1 day before', value: 1440 },
  { label: '2 days before', value: 2880 },
  { label: '1 week before', value: 10080 },
];

type Channel = keyof Channels;
const CHANNELS: { key: Channel; head: string; word: string }[] = [
  { key: 'bell', head: 'In the app', word: 'in the app' },
  { key: 'push', head: 'Phone', word: 'phone push' },
  { key: 'email', head: 'Email', word: 'email' },
];

const field = 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:!min-h-11';

/** The company's quiet hours in words. */
function companyQuietText(p: PersonPolicy): string {
  if (p.quietHours.mode === 'custom') return `From ${p.quietHours.start} to ${p.quietHours.end}, and on days off`;
  return `Outside working hours (${workingDaysText(p.workingDays)}, ${p.hours.start}–${p.hours.end}) and on days off`;
}

/**
 * Settings → Notifications (Notification & Scheduling centre): for each kind of notice, the bell (in the
 * app), the phone push and email — the company sets the defaults and may make some required; quiet hours
 * (the company's, the person's own, or none), what comes through them, the extra "due soon" reminder,
 * and "Pause everything except required".
 */
export function NotificationSettings() {
  const qc = useQueryClient();
  const prefsQ = useQuery({ queryKey: PREFS_KEY, queryFn: () => notificationsApi(apiClient).getPreferences() });
  const policyQ = useQuery({ queryKey: PERSON_POLICY_KEY, queryFn: () => notificationSettingsApi(apiClient).personPolicy() });
  const prefs: NotificationPreferences = prefsQ.data ?? { muted: [] };
  const policy = policyQ.data && Array.isArray(policyQ.data.kinds) ? policyQ.data : null;
  const [problem, setProblem] = useState<string | null>(null);
  // A channel just switched, shown as switched until the server's answer comes back.
  const [pending, setPending] = useState<Partial<Record<PolicyKind, Partial<Channels>>>>({});
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const save = useMutation({
    mutationFn: (body: NotificationPreferencesSave) => notificationsApi(apiClient).setPreferences(body),
    onMutate: () => setProblem(null),
    onSuccess: (data) => {
      qc.setQueryData(PREFS_KEY, data);
    },
    onError: () => setProblem('Couldn’t save that change. Please try again.'),
    onSettled: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: PREFS_KEY }), qc.invalidateQueries({ queryKey: PERSON_POLICY_KEY })]);
      setPending({});
    },
  });

  const channelOf = (k: PersonPolicy['kinds'][number]): Channels => ({ ...k.current, ...(pending[k.key] ?? {}) });
  const flip = (k: PersonPolicy['kinds'][number], ch: Channel) => {
    const next = !channelOf(k)[ch];
    setPending((p) => ({ ...p, [k.key]: { ...(p[k.key] ?? {}), [ch]: next, ...(ch === 'bell' && !next ? { push: false } : {}) } }));
    save.mutate({ channels: { [k.key]: { [ch]: next } } });
  };

  const paused = prefs.pauseUntil && Date.parse(prefs.pauseUntil) > now.getTime() ? prefs.pauseUntil : null;
  const zone = policy?.personZone ?? policy?.timeZone ?? 'Asia/Muscat';
  const breakThrough = {
    meetings: prefs.breakThrough?.meetings ?? policy?.quietHours.meetings ?? true,
    mentions: prefs.breakThrough?.mentions ?? policy?.quietHours.mentions ?? true,
  };
  const quiet: PersonQuietHours = prefs.quietHours ?? { mode: 'company', start: '22:00', end: '07:00', daysOff: true };
  const [own, setOwn] = useState({ start: quiet.start, end: quiet.end, daysOff: quiet.daysOff });
  const ownKey = `${quiet.start}|${quiet.end}|${quiet.daysOff}`;
  useEffect(() => setOwn({ start: quiet.start, end: quiet.end, daysOff: quiet.daysOff }), [ownKey]);

  const setMode = (mode: PersonQuietHours['mode']) => save.mutate({ quietHours: mode === 'company' ? null : { mode, start: own.start, end: own.end, daysOff: own.daysOff } });

  return (
    <section id="notifications" className="card scroll-mt-20 p-5 lg:col-span-2" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading" className="eyebrow mb-1">Notifications</h2>
      <p className="mb-4 text-sm text-ink-2">
        {policy?.companyName ? `${policy.companyName} sets` : 'Your company sets'} the defaults; change them for yourself here. Outside working hours the bell still fills, and phone
        pushes and emails wait for the next working morning — then come as one message.
      </p>
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      {prefsQ.isError || policyQ.isError ? (
        <LoadError what="your notification settings" onRetry={() => void Promise.all([prefsQ.refetch(), policyQ.refetch()])} />
      ) : !policy ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : (
        <>
          {/* Pause everything except required */}
          <div className="mb-4 rounded-xl border border-line bg-ground/60 p-3">
            {paused ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="text-sm text-ink">
                  <span className="font-semibold">Paused until {momentText(paused, zone)}.</span> Only what your company requires still comes through (its phone pushes wait too).
                </p>
                <Button size="sm" variant="secondary" onClick={() => save.mutate({ pauseUntil: null })} className="[@media(pointer:coarse)]:!min-h-11">
                  Resume now
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-ink">Pause everything except required</div>
                  <div className="text-xs text-ink-2">The bell still fills; nothing else reaches you until the pause ends.</div>
                </div>
                <div role="group" aria-label="Pause notifications" className="flex flex-wrap gap-1.5">
                  {pauseChoices(now, zone, policy.weekStart).map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => save.mutate({ pauseUntil: c.until })}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand/40 [@media(pointer:coarse)]:!min-h-11"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Each kind × channel */}
          <div role="table" aria-label="What reaches you, and how" className="text-sm">
            <div role="row" className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] items-end gap-x-2 border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,5rem)]">
              <span role="columnheader">Notice</span>
              {CHANNELS.map((c) => (
                <span role="columnheader" key={c.key} className="text-center">
                  {c.head}
                </span>
              ))}
            </div>
            {policy.kinds.map((k) => {
              const words = KIND_WORDS[k.key] ?? { label: k.key, desc: '' };
              const ch = channelOf(k);
              const note = !k.on ? 'Off for your company' : k.required ? 'Required by your company' : null;
              return (
                <div role="row" key={k.key} className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] items-center gap-x-2 border-b border-line py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(3,5rem)]">
                  <div role="cell" className="min-w-0">
                    <div className="font-medium text-ink">{words.label}</div>
                    <div className="text-xs text-ink-2">{words.desc}</div>
                    {note ? <div className={`mt-0.5 text-xs font-semibold ${k.on ? 'text-brand' : 'text-ink-3'}`}>{note}</div> : null}
                  </div>
                  {CHANNELS.map((c) => {
                    const locked = !k.on || (k.required && c.key !== 'email') || (c.key === 'push' && !ch.bell);
                    if (c.key === 'email' && !k.emailChannel)
                      return (
                        <div role="cell" key={c.key} className="text-center text-[11px] text-ink-3" title="Meeting reminder emails follow the reminder times your company set">
                          —
                        </div>
                      );
                    return (
                      <div role="cell" key={c.key} className="flex justify-center">
                        <Toggle on={k.on && ch[c.key]} onChange={() => flip(k, c.key)} label={`${words.label}: ${c.word}`} disabled={locked || save.isPending} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Quiet hours */}
          <fieldset className="mt-5 border-t border-line pt-4">
            <legend className="text-sm font-medium text-ink">Quiet hours</legend>
            <p className="mb-2 text-xs text-ink-2">Phone pushes and emails wait until quiet hours end; the bell still fills.</p>
            <div className="flex flex-col gap-2">
              {(
                [
                  { mode: 'company', label: `My company’s — ${companyQuietText(policy)}` },
                  { mode: 'custom', label: 'My own hours (in my time zone)' },
                  { mode: 'off', label: 'None — let everything through' },
                ] as const
              ).map((o) => (
                <label key={o.mode} className="flex cursor-pointer items-start gap-2 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
                  <input type="radio" name="quiet-hours" className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-brand))]" checked={quiet.mode === o.mode} onChange={() => setMode(o.mode)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
            {quiet.mode === 'custom' ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                  Quiet from
                  <input type="time" value={own.start} onChange={(e) => setOwn((o) => ({ ...o, start: e.target.value }))} className={field} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                  Until
                  <input type="time" value={own.end} onChange={(e) => setOwn((o) => ({ ...o, end: e.target.value }))} className={field} />
                </label>
                <div className="flex items-center gap-2 text-sm text-ink">
                  <Toggle on={own.daysOff} onChange={() => setOwn((o) => ({ ...o, daysOff: !o.daysOff }))} label="Quiet on days off" />
                  <span aria-hidden="true">Quiet on days off</span>
                </div>
                <Button size="sm" onClick={() => save.mutate({ quietHours: { mode: 'custom', start: own.start, end: own.end, daysOff: own.daysOff } })} disabled={save.isPending || !own.start || !own.end}>
                  Save quiet hours
                </Button>
              </div>
            ) : null}
          </fieldset>

          {/* What comes through quiet hours */}
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
            {(
              [
                { key: 'meetings', label: 'Meeting reminders come through quiet hours' },
                { key: 'mentions', label: '@mentions and direct messages come through quiet hours' },
              ] as const
            ).map((b) => (
              <div key={b.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{b.label}</span>
                <Toggle on={breakThrough[b.key]} onChange={() => save.mutate({ breakThrough: { ...breakThrough, [b.key]: !breakThrough[b.key] } })} label={b.label} disabled={save.isPending} />
              </div>
            ))}
          </div>

          {/* One extra "due soon" reminder of their own */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <div className="text-sm font-medium text-ink">Remind me before due</div>
              <div className="text-xs text-ink-2">Adds one extra “due soon” reminder for your tasks, on top of the project’s reminder schedule.</div>
            </div>
            <select
              aria-label="Reminder timing"
              value={prefs.reminderLeadMinutes ?? ''}
              onChange={(e) => save.mutate({ reminderLeadMinutes: e.target.value === '' ? null : Number(e.target.value) })}
              className={field}
            >
              {LEAD_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </section>
  );
}
