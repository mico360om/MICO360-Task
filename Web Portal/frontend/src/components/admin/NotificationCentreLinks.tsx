import { Link } from 'react-router-dom';
import { notificationSettingsPath } from '../../lib/notification-settings-path';

/** System Settings' way into Notification & Scheduling: the one place for working time, holidays, reminders and notification rules. */
export function NotificationCentreCard() {
  return (
    <section className="card card-pad lg:col-span-2" aria-labelledby="notification-centre-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="notification-centre-heading" className="eyebrow mb-1">
            Notification &amp; Scheduling
          </h2>
          <p className="text-sm text-ink-2">Working days and hours, holidays, reminder schedules, escalations, inactivity, quiet hours and channels — for each company.</p>
        </div>
        <Link
          to={notificationSettingsPath()}
          className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-brand transition-transform hover:-translate-y-0.5 [@media(pointer:coarse)]:!min-h-11"
        >
          Open Notification &amp; Scheduling
        </Link>
      </div>
    </section>
  );
}

/** A setting that moved into Notification & Scheduling: its old card keeps its heading and links there. */
export function MovedSettingCard({ heading, headingId, text, tab, tabLabel }: { heading: string; headingId: string; text: string; tab: string; tabLabel: string }) {
  return (
    <section className="card card-pad" aria-labelledby={headingId}>
      <h2 id={headingId} className="eyebrow mb-1">
        {heading}
      </h2>
      <p className="text-sm text-ink-2">
        {text}{' '}
        <Link to={notificationSettingsPath(tab)} className="font-semibold text-brand hover:underline">
          Now in Notification &amp; Scheduling → {tabLabel}
        </Link>
      </p>
    </section>
  );
}
