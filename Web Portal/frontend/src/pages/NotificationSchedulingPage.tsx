import { useRef, type ComponentType, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadError } from '../components/ui/LoadError';
import { apiClient } from '../api/client';
import { NOTIFICATION_SETTINGS_KEY, notificationSettingsApi } from '../api/notification-settings';
import { inputClass, settingsKey, type TabProps } from '../components/notify-settings/shared';
import { WorkingTimeTab } from '../components/notify-settings/WorkingTimeTab';
import { HolidaysTab } from '../components/notify-settings/HolidaysTab';
import { RemindersTab } from '../components/notify-settings/RemindersTab';
import { ChannelsTab, EscalationsTab, InactivityTab, QuietHoursTab } from '../components/notify-settings/PolicyTabs';
import { PreviewTab } from '../components/notify-settings/PreviewTab';

/** The panel's tabs, in order (the first opens by default); the open one is in the address (?tab=). */
export const NOTIFY_TABS: { key: string; label: string; Tab: ComponentType<TabProps> }[] = [
  { key: 'working-time', label: 'Working time', Tab: WorkingTimeTab },
  { key: 'holidays', label: 'Holidays', Tab: HolidaysTab },
  { key: 'reminders', label: 'Reminders', Tab: RemindersTab },
  { key: 'escalations', label: 'Escalations', Tab: EscalationsTab },
  { key: 'inactivity', label: 'Inactivity', Tab: InactivityTab },
  { key: 'quiet-hours', label: 'Quiet hours', Tab: QuietHoursTab },
  { key: 'channels', label: 'Channels', Tab: ChannelsTab },
  { key: 'preview', label: 'Preview', Tab: PreviewTab },
];

/**
 * System Settings → Notification & Scheduling: one place for each company's working time, holidays,
 * reminders and their schedules, escalations, inactivity, quiet hours and channels — and what a person
 * would get. People fine-tune their own in Settings → Notifications.
 */
export function NotificationSchedulingPage() {
  const [params, setParams] = useSearchParams();
  const companiesQ = useQuery({ queryKey: NOTIFICATION_SETTINGS_KEY, queryFn: () => notificationSettingsApi(apiClient).companies() });
  const companies = companiesQ.data?.companies ?? [];
  const companyId = companies.find((c) => c.id === params.get('company'))?.id ?? companies[0]?.id ?? null;
  const dataQ = useQuery({
    queryKey: settingsKey(companyId ?? ''),
    queryFn: () => notificationSettingsApi(apiClient).get(companyId!),
    enabled: !!companyId,
  });
  const current = NOTIFY_TABS.find((t) => t.key === params.get('tab')) ?? NOTIFY_TABS[0]!;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const go = (next: { tab?: string; company?: string }, focus = false) => {
    const tab = next.tab ?? current.key;
    const company = next.company ?? companyId ?? undefined;
    const p: Record<string, string> = {};
    if (tab !== NOTIFY_TABS[0]!.key) p.tab = tab;
    if (company && companies.length > 1) p.company = company;
    setParams(p, { replace: true });
    if (focus) buttons.current.get(tab)?.focus();
  };

  // Arrow keys, Home and End move along the tabs (the open one is the only Tab stop).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = NOTIFY_TABS.findIndex((t) => t.key === current.key);
    const move = (i: number) => {
      e.preventDefault();
      go({ tab: NOTIFY_TABS[(i + NOTIFY_TABS.length) % NOTIFY_TABS.length]!.key }, true);
    };
    if (e.key === 'ArrowRight') move(at + 1);
    else if (e.key === 'ArrowLeft') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(NOTIFY_TABS.length - 1);
  }

  const banners = dataQ.data?.banners ?? [];
  const Tab = current.Tab;

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Notification & Scheduling" subtitle="Working days, holidays, reminders, escalations, quiet hours and channels — each person fine-tunes their own in Settings." />
      <p className="mb-3 text-sm">
        <Link to="/admin/settings" className="font-semibold text-brand hover:underline">
          ← System Settings
        </Link>
      </p>
      {companies.length > 1 ? (
        <label className="mb-4 flex max-w-sm flex-col gap-1 text-xs font-medium text-ink-2">
          Company
          <select value={companyId ?? ''} onChange={(e) => go({ company: e.target.value })} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {banners.length && current.key !== 'holidays' ? (
        <div className="mb-4 grid gap-2">
          {banners.map((b) => (
            <p key={`${b.name}${b.year}`} className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-ink">
              <span className="font-semibold">{b.text}.</span>{' '}
              <button type="button" onClick={() => go({ tab: 'holidays' })} className="font-semibold text-brand underline">
                Open Holidays
              </button>
            </p>
          ))}
        </div>
      ) : null}
      <div role="tablist" aria-label="Notification & Scheduling" onKeyDown={onKeyDown} className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
        {NOTIFY_TABS.map((t) => {
          const selected = t.key === current.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                if (el) buttons.current.set(t.key, el);
                else buttons.current.delete(t.key);
              }}
              type="button"
              role="tab"
              id={`nst-tab-${t.key}`}
              aria-controls={`nst-panel-${t.key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => go({ tab: t.key })}
              className={`!min-h-[44px] flex-none border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${selected ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div key={`${current.key}|${companyId ?? ''}`} role="tabpanel" id={`nst-panel-${current.key}`} aria-labelledby={`nst-tab-${current.key}`} className="mt-4 max-w-4xl">
        {companiesQ.isError ? (
          <LoadError what="the companies" onRetry={() => void companiesQ.refetch()} />
        ) : dataQ.isError ? (
          <LoadError what="the notification settings" onRetry={() => void dataQ.refetch()} />
        ) : !companyId && companiesQ.isSuccess ? (
          <p className="text-sm text-ink-2">There is no active company to set up.</p>
        ) : !dataQ.data ? (
          <p className="text-sm text-ink-2">Loading…</p>
        ) : (
          <Tab companyId={companyId!} data={dataQ.data} companyCount={companies.length} />
        )}
      </div>
    </div>
  );
}
