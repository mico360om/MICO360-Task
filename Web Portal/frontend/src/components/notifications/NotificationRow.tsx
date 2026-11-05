import type { ApiNotification } from '../../api/notifications';
import { clockText } from '../../lib/day-words';
import { TOUCH_SQUARE } from '../../lib/touch';
import { ProjectAvatar } from '../ProjectAvatar';
import { NotificationKindIcon, notificationKindLook } from './NotificationKindIcon';
import { TaskKey, bodyWithoutKey } from '../TaskKey';
import { DENSE_TEXT } from '../../lib/density-tokens';

export interface NotificationRowProps {
  n: ApiNotification;
  timeZone: string;
  /** Tick boxes shown (always on a wide screen; after "Select" on a phone). */
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onToggleRead: () => void;
  onRemove: () => void;
}

const ICON_BUTTON = `grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition-colors compact:h-7 compact:w-7 hover:bg-ground hover:text-ink focus-visible:text-ink ${TOUCH_SQUARE}`;

/**
 * One notification on the Notifications page: tick box, its kind's icon, title, details and project
 * (opening what it is about), its time ("09:05"; the day is the group's heading), and Mark read /
 * Mark unread and Remove. Unread rows keep the brand edge and a stronger title, as in the bell.
 */
export function NotificationRow({ n, timeZone, selectable, selected, onToggleSelect, onOpen, onToggleRead, onRemove }: NotificationRowProps) {
  const read = !!n.readAt;
  const kind = notificationKindLook(n.type);
  const time = clockText(n.createdAt, timeZone);
  const body = bodyWithoutKey(n.body, n.taskKey);
  return (
    <li
      data-notification-id={n.id}
      // Compact rows (1.23.0, lib/density): a third less padding, the title a step smaller.
      className={`flex items-start gap-2.5 rounded-lg border border-line bg-surface p-2.5 transition-colors hover:border-brand/40 sm:gap-3 sm:p-3 compact:gap-2 compact:p-2 ${read ? '' : 'border-l-4 border-l-brand'} ${selected ? 'ring-2 ring-brand/40' : ''}`}
    >
      {selectable ? (
        <label className="-m-1 grid h-10 w-8 flex-none cursor-pointer place-items-center compact:h-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <input type="checkbox" aria-label={`Select: ${n.title}`} checked={selected} onChange={onToggleSelect} className="h-4 w-4 cursor-pointer accent-brand" />
        </label>
      ) : null}
      <NotificationKindIcon type={n.type} />
      {/* data-open: where the keyboard goes when a neighbouring row is removed. */}
      <button type="button" data-open onClick={onOpen} className="min-w-0 flex-1 rounded text-start [@media(pointer:coarse)]:!min-h-11">
        <span className="sr-only">{`${kind.name}:`} </span>
        <span dir="auto" className={`block text-sm ${DENSE_TEXT} ${read ? 'text-ink-2' : 'font-medium text-ink'}`}>{n.title}</span>
        {/* 1.22.3: the task's number now, as the chip; the words then skip the number they start with. */}
        {n.taskKey ? (
          <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
            <TaskKey value={n.taskKey} dense="compact" />
            {body ? <span dir="auto" className="min-w-0 whitespace-pre-line text-xs text-ink-2 [overflow-wrap:anywhere]">{body}</span> : null}
          </span>
        ) : body ? (
          <span dir="auto" className="mt-0.5 block whitespace-pre-line text-xs text-ink-2 [overflow-wrap:anywhere]">{body}</span>
        ) : null}
        {n.project ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-3 compact:mt-0.5">
            <ProjectAvatar project={n.project} size="xs" />
            <bdi className="truncate">{n.project.name}</bdi>
          </span>
        ) : null}
      </button>
      <div className="flex flex-none items-center gap-0.5 self-start">
        {time ? <time dateTime={n.createdAt} className="me-1 text-xs tabular-nums text-ink-3">{time}</time> : null}
        <button type="button" onClick={onToggleRead} aria-label={`${read ? 'Mark unread' : 'Mark read'}: ${n.title}`} title={read ? 'Mark unread' : 'Mark read'} className={ICON_BUTTON}>
          {read ? (
            // Unread again: the unread dot.
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
          )}
        </button>
        <button type="button" onClick={onRemove} aria-label={`Remove: ${n.title}`} title="Remove" className={`${ICON_BUTTON} hover:text-danger`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </li>
  );
}
