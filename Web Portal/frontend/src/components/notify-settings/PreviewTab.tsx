import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { notificationSettingsApi, NOTIFICATION_SETTINGS_KEY, type ChannelAction, type PreviewItem } from '../../api/notification-settings';
import { LoadError } from '../ui/LoadError';
import { momentText } from '../../lib/notify-kinds';
import { shortDay } from '../../lib/useWorkingTime';
import { Panel, inputClass, type TabProps } from './shared';

function pushText(i: PreviewItem, zone: string): string {
  const at: Record<ChannelAction, string> = { now: 'Phone now', hold: i.releaseAt ? `Phone at ${momentText(i.releaseAt, zone)}` : 'Phone later', off: 'No phone push' };
  return at[i.push];
}
function emailText(i: PreviewItem, zone: string): string {
  if (i.email === 'now') return 'Email now';
  if (i.email === 'hold') return i.releaseAt ? `Email with the morning’s daily email (by ${momentText(i.releaseAt, zone)})` : 'Email later';
  return 'No email';
}

/** "Preview for a person": what they would get each day of the coming week, and how it reaches them. */
export function PreviewTab({ companyId, data }: TabProps) {
  const [userId, setUserId] = useState('');
  const q = useQuery({
    queryKey: [...NOTIFICATION_SETTINGS_KEY, companyId, 'preview', userId],
    queryFn: () => notificationSettingsApi(apiClient).preview(companyId, userId),
    enabled: !!userId,
  });
  const p = q.data;
  const zone = p && 'zone' in p.quietHours ? p.quietHours.zone : data.timeZone;

  return (
    <Panel title="Preview for a person" id="nst-preview">
      <p className="mb-3 text-sm text-ink-2">What someone would get this week from their tasks — by their own settings and quiet hours. (Comments, assignments and other events aren’t planned, so they aren’t shown.)</p>
      <label className="flex max-w-sm flex-col gap-1 text-xs font-medium text-ink-2">
        Person
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass}>
          <option value="">Choose a person…</option>
          {data.people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      {q.isError ? <LoadError what="the preview" onRetry={() => void q.refetch()} className="mt-3" /> : null}
      {userId && q.isLoading ? <p className="mt-3 text-sm text-ink-2">Working it out…</p> : null}
      {p ? (
        <div className="mt-4">
          <p className="mb-3 text-sm text-ink">
            <span className="font-medium">Quiet hours:</span>{' '}
            {'mode' in p.quietHours ? 'none' : `${p.quietHours.start}–${p.quietHours.end} (${p.quietHours.zone})${p.quietHours.daysOff ? ', and days off' : ''}`}
            {p.paused ? ` · Paused until ${momentText(p.paused, zone)}` : ''}
          </p>
          <ol className="grid gap-3">
            {p.days.map((d) => (
              <li key={d.day} className="rounded-xl border border-line p-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-ink">{shortDay(d.day)}</span>
                  {d.holiday ? <span className="text-xs text-ink-2">Day off: {d.holiday}</span> : !d.working ? <span className="text-xs text-ink-2">Not a working day</span> : null}
                </div>
                {d.items.length === 0 ? (
                  <p className="text-xs text-ink-3">Nothing planned.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {d.items.map((i, n) => (
                      <li key={`${i.taskId}${i.type}${n}`} className="py-2">
                        <div className="text-sm font-medium text-ink">{i.title}</div>
                        <div className="text-xs text-ink-2">
                          <bdi>{i.body}</bdi>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                          <span className="rounded-full bg-ground px-2 py-0.5 text-ink-2">{i.bell ? 'In the app' : 'Not in the app'}</span>
                          <span className="rounded-full bg-ground px-2 py-0.5 text-ink-2">{pushText(i, zone)}</span>
                          <span className="rounded-full bg-ground px-2 py-0.5 text-ink-2">{emailText(i, zone)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Panel>
  );
}
