import { Link } from 'react-router-dom';
import { ACTION_STATUS_LABELS, type ActionItemStatus } from '../../../api/meetings';
import type { CarriedItem } from '../../../api/meeting-series';
import { SearchableSelect } from '../../ui/SearchableSelect';
import { badgeToneClass } from '../../ui/Badge';
import { actionStatusTone } from '../../../lib/meetingFormat';
import { dueDayKey } from '../../../lib/due-date';
import { dayText } from '../../../lib/day-words';
import { seriesDay } from '../../../lib/meeting-series';
import { TOUCH_TALL } from '../../../lib/touch';
import { Icon, TaskNumber } from '../kit';

const STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
const CHIP = 'inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-xs font-medium';

/**
 * Open action items of a series' meetings — the same items as on their own meetings: what, the
 * meeting each came from ("from 3 Nov"), who owns it, when it is due and where it stands. With
 * `onStatus` the status is a chip to change (it changes everywhere); otherwise it is read-only.
 */
export function CarriedItems({
  items,
  timeZone,
  onStatus,
  busy = false,
  now = new Date(),
}: {
  items: CarriedItem[];
  timeZone: string;
  onStatus?: (item: CarriedItem, status: ActionItemStatus) => void;
  busy?: boolean;
  now?: Date;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((item) => {
        const day = dueDayKey(item.dueDate, timeZone);
        const from = seriesDay(item.meeting.startAt, timeZone, now);
        const d = item.description;
        return (
          <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2">
            <p className="min-w-0 flex-[1_1_14rem] text-sm text-ink [overflow-wrap:anywhere]">
              <bdi>{d}</bdi>
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Link
                to={`/meetings/${encodeURIComponent(item.meeting.id)}`}
                title={item.meeting.title}
                aria-label={`From the meeting ${item.meeting.title}, ${from}`}
                className={`${CHIP} bg-ground text-ink-2 hover:text-brand ${TOUCH_TALL}`}
              >
                from {from}
              </Link>
              <span className={`${CHIP} bg-ground ${item.assigneeName ? 'text-ink' : 'text-ink-3'}`}>
                <span className="sr-only">Owner: </span>
                <bdi className="truncate">{item.assigneeName ?? 'Unassigned'}</bdi>
              </span>
              <span className={`${CHIP} ${item.overdue ? 'bg-danger-soft font-semibold text-danger' : day ? 'bg-ground text-ink' : 'bg-ground text-ink-3'}`}>
                {day ? <>Due {dayText(day)}</> : 'No due date'}
                {item.overdue ? <span> · overdue</span> : null}
              </span>
              {onStatus ? (
                <SearchableSelect
                  size="chip"
                  ariaLabel={`Status for ${d}: ${ACTION_STATUS_LABELS[item.status]}`}
                  options={STATUSES.map((s) => ({ value: s, label: ACTION_STATUS_LABELS[s] }))}
                  value={item.status}
                  disabled={busy}
                  onChange={(v) => onStatus(item, v as ActionItemStatus)}
                  chipClassName={badgeToneClass(actionStatusTone(item.status))}
                />
              ) : (
                <span className={`${CHIP} ${badgeToneClass(actionStatusTone(item.status))}`}>{ACTION_STATUS_LABELS[item.status]}</span>
              )}
              {item.taskId ? (
                <Link to={`?task=${encodeURIComponent(item.taskId)}`} className={`group inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-xs font-medium text-ink-2 hover:text-brand ${TOUCH_TALL}`}>
                  <span className="text-success">{Icon.task}</span>
                  <TaskNumber value={item.taskKey} />
                  <span className="sr-only"> — open the linked task</span>
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
