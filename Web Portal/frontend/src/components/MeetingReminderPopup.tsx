import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NOTIFICATIONS_KEY, UNREAD_COUNT_KEY, type ApiNotification } from '../api/notifications';
import { useOpenNotification } from '../lib/notification-links';
import { useNotificationRealtime } from '../lib/useNotificationRealtime';
import { popupsAfter, popupsWithout, readLiveNotification } from '../lib/meeting-reminder-popup';
import { Button } from './ui/Button';

/**
 * The website's live pop-up for automatic meeting reminders ("Meeting in 15 minutes: …"), in the
 * corner of every page while the site is open. Every new notification refreshes the bell at once
 * (instead of at its 30-second poll); a meeting reminder also pops up until it is opened or
 * dismissed. It never takes the focus; screen readers read it out politely. Mounted once in the
 * app shell.
 */
export function MeetingReminderPopup() {
  const qc = useQueryClient();
  const [popups, setPopups] = useState<ApiNotification[]>([]);
  const { open } = useOpenNotification();
  const refreshBell = () => {
    void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  };

  useNotificationRealtime((payload) => {
    const n = readLiveNotification(payload);
    if (!n) return;
    refreshBell();
    setPopups((list) => popupsAfter(list, n));
  }, refreshBell);

  const dismiss = (id: string) => setPopups((list) => popupsWithout(list, id));

  return (
    <div
      role="region"
      aria-label="Meeting reminders"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-2 bottom-2 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:bottom-4 sm:end-4 sm:w-96"
    >
      {popups.map((n) => (
        <div key={n.id} className="pointer-events-auto rounded-xl border border-line bg-surface p-3 shadow-lift">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand/10 text-brand" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="5" width="17" height="15" rx="2" />
                <path d="M3.5 10h17M8 3v4M16 3v4M12 13.5v2.5l1.5 1" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p id={`meeting-popup-${n.id}`} dir="auto" className="text-sm font-semibold text-ink">{n.title}</p>
              {n.body ? <p dir="auto" className="mt-0.5 text-xs text-ink-2">{n.body}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  aria-describedby={`meeting-popup-${n.id}`}
                  onClick={() => {
                    dismiss(n.id);
                    open(n);
                  }}
                >
                  Open meeting
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              aria-label={`Dismiss: ${n.title}`}
              className="grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
