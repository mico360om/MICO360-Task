import { Link } from 'react-router-dom';
import type { ActionItem } from '../../../api/meetings';
import type { CarriedItem } from '../../../api/meeting-series';
import type { MeetingTableExtraGroup } from '../MeetingTable';
import { seriesDay } from '../../../lib/meeting-series';
import { TOUCH_TALL } from '../../../lib/touch';

const STATUS_ONLY = new Set(['status'] as const);

/** A carried item as the meeting table's action item: the same item, of its own (earlier) meeting. */
function asActionItem(c: CarriedItem): ActionItem {
  return {
    id: c.id,
    meetingId: c.meeting.id,
    agendaItemId: null,
    sourceNoteId: null,
    projectId: null,
    description: c.description,
    assigneeId: c.assigneeId,
    priority: c.priority,
    status: c.status,
    dueDate: c.dueDate,
    progress: 0,
    completedAt: null,
    taskId: c.taskId,
    createdById: c.createdById,
    createdAt: c.meeting.startAt,
    updatedAt: c.meeting.startAt,
    overdue: c.overdue,
    taskKey: c.taskKey,
  };
}

/**
 * 1.23 (Table view × meeting series, design call 2 of the table design): a series' "Open from earlier
 * meetings" as the meeting table's last group — the same items (a status changed here changes
 * everywhere), each noted "from 3 Nov" with a link to its meeting, and the section's own rule: the
 * status may be changed where the section lets it be (`editable`), nothing else. No items: no group.
 */
export function carriedTableGroups(items: readonly CarriedItem[], opts: { timeZone: string; editable: boolean; now?: Date }): MeetingTableExtraGroup[] {
  if (items.length === 0) return [];
  const byId = new Map(items.map((c) => [c.id, c]));
  return [
    {
      key: 'carried',
      label: 'Open from earlier meetings',
      items: items.map(asActionItem),
      note: (i) => {
        const c = byId.get(i.id);
        if (!c) return null;
        const from = seriesDay(c.meeting.startAt, opts.timeZone, opts.now);
        return (
          <Link
            to={`/meetings/${encodeURIComponent(c.meeting.id)}`}
            title={c.meeting.title}
            aria-label={`from ${from}: ${c.meeting.title}`}
            className={`inline-flex items-center rounded-sm text-ink-2 underline-offset-2 hover:text-brand hover:underline ${TOUCH_TALL}`}
          >
            from {from}
          </Link>
        );
      },
      ...(opts.editable ? { editable: () => STATUS_ONLY } : {}),
    },
  ];
}
