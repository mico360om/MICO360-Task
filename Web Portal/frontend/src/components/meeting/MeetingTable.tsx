import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { meetingsApi, ACTION_STATUS_LABELS, type ActionItem, type ActionItemStatus, type AgendaItem, type Priority } from '../../api/meetings';
import type { DirectoryUser } from '../../api/users';
import { DataTable, CELL, PINNED_HEAD_CELL, type DataColumn, type DataSection } from '../data-table/DataTable';
import { TableFilterBar } from '../data-table/FilterBar';
import { MinutesCell, TitleCell } from '../data-table/cells';
import { useRowEdits, useTableMemory } from '../data-table/hooks';
import { ME, NO_PERSON, OPEN_ONLY, tableFiltersActive, EMPTY_TABLE_FILTERS } from '../../lib/data-table';
import { ACTION_STATUSES, actionItemSortValue, filterActionItems, groupActionItems, itemTopic } from '../../lib/meeting-table';
import { actionStatusTone, isActionItemOverdue } from '../../lib/meetingFormat';
import { dueDayKey, todayKey } from '../../lib/due-date';
import { dayText } from '../../lib/day-words';
import { useDateSettings } from '../../lib/useDatePrefs';
import { useOpenTask } from '../../lib/useOpenTask';
import { useAuthStore } from '../../stores/auth-store';
import { SearchableSelect } from '../ui/SearchableSelect';
import { DayPickerButton } from '../ui/DateTimeField';
import { badgeToneClass, type BadgeTone } from '../ui/Badge';
import { TaskKey } from '../TaskKey';
import { LoadError, Section, peopleOptions, userName } from './kit';
import { AgendaAddForm } from './AgendaSection';
import { ActionItemAddForm } from './ActionItemsSection';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { READ_ONLY_NOTICE, type ProjectReadOnly } from '../../lib/project-archive';

/** An action item's fields that can be changed in the table. */
export type ItemField = 'description' | 'topic' | 'owner' | 'priority' | 'due' | 'status';

/**
 * A group of action items after Other, from somewhere else (the hook for 1.23.0 meeting series'
 * "Open from earlier meetings"): its heading, its items (the same action items as on their own
 * meetings), a note after each item's words ("from 3 Nov") and which fields may be changed here —
 * that section's own rules; none (the default): to look at.
 */
export interface MeetingTableExtraGroup {
  key: string;
  label: string;
  items: ActionItem[];
  note?: (item: ActionItem) => ReactNode;
  editable?: (item: ActionItem) => ReadonlySet<Exclude<ItemField, 'topic'>>;
  /**
   * 1.23 (series): the owner's name as the group's source gave it — they may not be among this meeting's
   * people (someone of an earlier meeting only). Used to name them; never offered as an owner here.
   */
  ownerName?: (item: ActionItem) => string | null;
}

export interface MeetingTableProps {
  meetingId: string;
  directory: DirectoryUser[];
  /** May change the agenda (its organizer, the project's managers, an administrator — the List's rule). */
  canEdit: boolean;
  pollMs: number | false;
  timeZone: string;
  /** List | Table, at the top. */
  switcher?: ReactNode;
  /** Nothing to change here (an invitee from another company): the agenda and their own items to read. */
  readOnly?: boolean;
  /** The page's own list of items instead of the meeting's (an invitee's own). */
  items?: ActionItem[];
  /** More groups after Other (see MeetingTableExtraGroup). */
  extraGroups?: MeetingTableExtraGroup[];
  /**
   * Its project is archived: the server takes no change to its agenda or action items, so the table is
   * there to look at and says why (the project's notice). Null: none.
   */
  locked?: ProjectReadOnly | null;
}

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const PRIORITY_TONE: Record<Priority, BadgeTone> = { LOW: 'neutral', NORMAL: 'info', HIGH: 'warning', URGENT: 'danger' };
const CHIP = 'inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-xs font-medium';
const COVERED = [
  { value: 'yes', label: 'Covered ✓' },
  { value: 'no', label: 'Not covered' },
];
const ALL_FIELDS: ReadonlySet<ItemField> = new Set(['description', 'topic', 'owner', 'priority', 'due', 'status']);
const NO_FIELDS: ReadonlySet<ItemField> = new Set();
const OTHER = '__other';

/** Is there anything for the Table view to show — a topic or an action item? (The switch is offered only then.) */
export function useMeetingTableAvailable(meetingId: string, items?: ActionItem[]): boolean {
  const agendaQ = useQuery({ queryKey: ['meeting', meetingId, 'agenda'], queryFn: () => meetingsApi(apiClient).listAgenda(meetingId), enabled: !!meetingId });
  const itemsQ = useQuery({ queryKey: ['meeting', meetingId, 'action-items'], queryFn: () => meetingsApi(apiClient).listActionItems(meetingId), enabled: !!meetingId && !items });
  const list = items ?? (Array.isArray(itemsQ.data) ? itemsQ.data : []);
  return (Array.isArray(agendaQ.data) && agendaQ.data.length > 0) || list.length > 0;
}

/**
 * A meeting's agenda and action items as one table (1.23.0): each topic a group row in agenda order —
 * its number and title, presenter, planned minutes and whether it was covered — with its action items
 * under it (words, topic, owner, priority, due date, status, the linked task's number), then Other.
 * Sorting orders the items inside each topic; the topics keep the agenda's order (reordering stays in
 * the List). Topics are changed in place by whoever may edit the agenda, items by whoever may change
 * them in the List — shown at once, put back with the site's plain error if refused. The add forms
 * stay under the table.
 */
export function MeetingTable({ meetingId, directory, canEdit, pollMs, timeZone, switcher, readOnly = false, items: givenItems, extraGroups = [], locked = null }: MeetingTableProps) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const openTask = useOpenTask();
  const { weekStart } = useDateSettings();
  const today = todayKey(timeZone);
  const memory = useTableMemory('meeting', { shown: ['topic'] });
  const itemEdits = useRowEdits<ActionItem>();
  const topicEdits = useRowEdits<AgendaItem>();
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());

  const agendaQ = useQuery({ queryKey: ['meeting', meetingId, 'agenda'], queryFn: () => meetingsApi(apiClient).listAgenda(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  const itemsQ = useQuery({ queryKey: ['meeting', meetingId, 'action-items'], queryFn: () => meetingsApi(apiClient).listActionItems(meetingId), enabled: !!meetingId && !givenItems, refetchInterval: pollMs });
  // An invitee doesn't read the notes; their items' topics are their own.
  const notesQ = useQuery({ queryKey: ['meeting', meetingId, 'notes'], queryFn: () => meetingsApi(apiClient).listNotes(meetingId), enabled: !!meetingId && !readOnly, refetchInterval: pollMs });

  const rawTopics = useMemo(() => (Array.isArray(agendaQ.data) ? [...agendaQ.data] : []).sort((a, b) => a.position - b.position), [agendaQ.data]);
  const topics = topicEdits.apply(rawTopics, (t) => t.id);
  const rawItems = useMemo(() => givenItems ?? (Array.isArray(itemsQ.data) ? itemsQ.data : []), [givenItems, itemsQ.data]);
  const items = itemEdits.apply(rawItems, (i) => i.id);
  const notes = useMemo(() => new Map((Array.isArray(notesQ.data) ? notesQ.data : []).map((n) => [n.id, n])), [notesQ.data]);
  const topicName = new Map(topics.map((t, i) => [t.id, `${i + 1}. ${t.title}`]));
  // Carried groups name their items' owners (people of earlier meetings may not be among this one's).
  const extraNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const g of extraGroups) {
      if (!g.ownerName) continue;
      for (const i of g.items) {
        const name = i.assigneeId ? g.ownerName(i) : null;
        if (i.assigneeId && name) names.set(i.assigneeId, name);
      }
    }
    return names;
  }, [extraGroups]);
  const ownerName = (id: string | null) => userName(directory, id) ?? (id ? (extraNames.get(id) ?? null) : null);

  const personOptions = useMemo(() => {
    const ids = new Set([...rawItems, ...extraGroups.flatMap((g) => g.items)].map((i) => i.assigneeId).filter((x): x is string => Boolean(x) && x !== myId));
    return [
      { value: '', label: 'Anyone' },
      { value: ME, label: 'Me' },
      { value: NO_PERSON, label: 'Unassigned' },
      ...[...ids].map((id) => ({ value: id, label: userName(directory, id) ?? extraNames.get(id) ?? 'Someone' })).sort((a, b) => a.label.localeCompare(b.label, 'en')),
    ];
  }, [rawItems, extraGroups, extraNames, directory, myId]);
  const statusOptions = [{ value: '', label: 'Any status' }, { value: OPEN_ONLY, label: 'Open only' }, ...ACTION_STATUSES.map((s) => ({ value: s, label: ACTION_STATUS_LABELS[s] }))];
  // Remembered for the page, not each meeting: an owner with no items here is let go (never an empty
  // table with a blank box).
  const filters = { ...memory.filters, person: personOptions.some((o) => o.value === memory.filters.person) ? memory.filters.person : '' };
  const filtering = tableFiltersActive(filters);
  const shownItems = filterActionItems(items, filters, myId);
  // A carried group's items show a change at once too (they are saved like the meeting's own).
  const extra = extraGroups.map((g) => ({ ...g, shown: filterActionItems(itemEdits.apply(g.items, (i) => i.id), filters, myId) }));
  const allExtra = extraGroups.reduce((n, g) => n + g.items.length, 0);
  const shownExtra = extra.reduce((n, g) => n + g.shown.length, 0);

  // ── Saving ──
  const rawItemById = new Map([...rawItems, ...extraGroups.flatMap((g) => g.items)].map((i) => [i.id, i]));
  // What shows action items: this meeting's list (and, with carried groups, its series'), My Action
  // Items and the meetings lists — as the List refreshes them.
  const afterItem = (i: ActionItem) => {
    void qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'action-items'] });
    if (extraGroups.length) void qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'series'] });
    // A carried item is of an earlier meeting: its own list too (as the List's carry-over section does).
    if (i.meetingId && i.meetingId !== meetingId) void qc.invalidateQueries({ queryKey: ['meeting', i.meetingId, 'action-items'] });
    void qc.invalidateQueries({ queryKey: ['my-action-items'] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
  };
  const saveItem = (i: ActionItem, patch: Partial<ActionItem>, body: Parameters<ReturnType<typeof meetingsApi>['updateActionItem']>[1]) => {
    const base = rawItemById.get(i.id);
    if (!base) return;
    void itemEdits.edit(i.id, base, patch, async () => {
      const saved = await meetingsApi(apiClient).updateActionItem(i.id, body);
      afterItem(i);
      const keys = Object.keys(patch) as (keyof ActionItem)[];
      return Object.fromEntries(keys.map((k) => [k, saved[k]])) as Partial<ActionItem>;
    });
  };
  const rawTopicById = new Map(rawTopics.map((t) => [t.id, t]));
  const saveTopic = (t: AgendaItem, patch: Partial<AgendaItem>) => {
    const base = rawTopicById.get(t.id);
    if (!base) return;
    void topicEdits.edit(t.id, base, patch, async () => {
      const saved = await meetingsApi(apiClient).updateAgendaItem(meetingId, t.id, patch);
      void qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'agenda'] });
      const keys = Object.keys(patch) as (keyof AgendaItem)[];
      return Object.fromEntries(keys.map((k) => [k, saved[k]])) as Partial<AgendaItem>;
    });
  };

  // What may be changed: a meeting's items as in the List (anyone who sees it in full); a carried
  // group's by its own rules; nothing on a read-only table.
  const extraOf = new Map(extra.flatMap((g) => g.items.map((i) => [i.id, g] as const)));
  const noChanges = readOnly || locked !== null;
  const fieldsOf = (i: ActionItem): ReadonlySet<ItemField> => {
    if (noChanges) return NO_FIELDS;
    const g = extraOf.get(i.id);
    if (g) return g.editable ? g.editable(i) : NO_FIELDS;
    return ALL_FIELDS;
  };
  const agendaEditable = canEdit && !noChanges;

  // ── Columns ──
  const people = peopleOptions(directory, 'Unassigned');
  const columns: DataColumn<ActionItem>[] = [
    {
      id: 'title',
      label: 'Item',
      sortable: true,
      pin: true,
      rowHeader: true,
      className: 'min-w-[16rem] max-md:min-w-[9.5rem] max-md:max-w-[11rem] ps-9 max-md:ps-3',
      cell: (i) => {
        const done = i.status === 'COMPLETED' || i.status === 'CANCELLED';
        const note = extraOf.get(i.id)?.note?.(i);
        return (
          <span className="flex min-w-0 flex-col gap-0.5">
            <TitleCell
              value={i.description}
              what={`the words of ${i.description}`}
              editable={fieldsOf(i).has('description')}
              onSave={(next) => saveItem(i, { description: next }, { description: next })}
              emptyMessage="Describe the action item."
              done={done}
            />
            {i.taskKey || note ? (
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                {i.taskKey ? <TaskKey value={i.taskKey} /> : null}
                {note ? <span>{note}</span> : null}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'topic',
      label: 'Topic',
      optional: true,
      className: 'max-w-[12rem]',
      cell: (i) => {
        if (extraOf.has(i.id)) return <span className="text-ink-3">—</span>;
        const { id } = itemTopic(i, notes);
        const current = id && topicName.has(id) ? id : '';
        const label = current ? topicName.get(current)! : 'No topic';
        if (!fieldsOf(i).has('topic') || topics.length === 0) return <span dir="auto" className={`text-xs ${current ? 'text-ink-2' : 'text-ink-3'}`}>{label}</span>;
        // An item made from a note under a topic keeps to a topic: with none it would be shown under its
        // note's again (nothing keeps "none on purpose") — older items and, since 1.23.0, new ones alike.
        const noteTopic = i.sourceNoteId ? notes.get(i.sourceNoteId)?.agendaItemId : null;
        const noNone = Boolean(noteTopic && topicName.has(noteTopic));
        const choices = [...(noNone ? [] : [{ value: '', label: 'No topic' }]), ...topics.map((t) => ({ value: t.id, label: topicName.get(t.id)! }))];
        return (
          <SearchableSelect
            size="chip"
            ariaLabel={`Topic of ${i.description}: ${label}`}
            value={current}
            onChange={(v) => v !== current && saveItem(i, { agendaItemId: v || null }, { agendaItemId: v || null })}
            options={choices}
            chipClassName={current ? 'bg-ground text-ink-2' : 'bg-ground text-ink-3'}
          />
        );
      },
    },
    {
      id: 'owner',
      label: 'Owner',
      sortable: true,
      className: 'max-w-[12rem]',
      cell: (i) => {
        const name = ownerName(i.assigneeId);
        if (!fieldsOf(i).has('owner')) return <bdi className={`text-xs ${name ? 'text-ink' : 'text-ink-3'}`}>{name ?? 'Unassigned'}</bdi>;
        return (
          <SearchableSelect
            size="chip"
            ariaLabel={`Owner of ${i.description}: ${name ?? 'Unassigned'}`}
            placeholder="Unassigned"
            value={i.assigneeId ?? ''}
            onChange={(v) => (v || null) !== i.assigneeId && saveItem(i, { assigneeId: v || null }, { assigneeId: v || null })}
            options={people}
            chipClassName={name ? 'bg-ground text-ink' : 'bg-ground text-ink-3'}
          />
        );
      },
    },
    {
      id: 'priority',
      label: 'Priority',
      sortable: true,
      className: 'w-px whitespace-nowrap',
      cell: (i) =>
        fieldsOf(i).has('priority') ? (
          <SearchableSelect
            size="chip"
            ariaLabel={`Priority of ${i.description}: ${PRIORITY_LABEL[i.priority]}`}
            value={i.priority}
            onChange={(v) => v !== i.priority && saveItem(i, { priority: v as Priority }, { priority: v as Priority })}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            chipClassName={badgeToneClass(PRIORITY_TONE[i.priority])}
          />
        ) : (
          <span className={`${CHIP} ${badgeToneClass(PRIORITY_TONE[i.priority])}`}>{PRIORITY_LABEL[i.priority]}</span>
        ),
    },
    {
      id: 'due',
      label: 'Due date',
      sortable: true,
      className: 'w-px whitespace-nowrap',
      cell: (i) => {
        const day = dueDayKey(i.dueDate, timeZone) ?? '';
        const late = isActionItemOverdue(i, timeZone);
        const words = day ? dayText(day, { year: day.slice(0, 4) !== today.slice(0, 4) }) : 'No due date';
        const tone = late ? 'bg-danger-soft font-semibold text-danger' : day ? 'bg-ground text-ink' : 'bg-ground text-ink-3';
        if (!fieldsOf(i).has('due')) return <span className={`${CHIP} ${tone}`}>{late ? `Overdue · ${words}` : words}</span>;
        return (
          <DayPickerButton
            ariaLabel={`Due date of ${i.description}: ${day ? dayText(day) : 'No due date'}${late ? ', overdue' : ''}`}
            value={day}
            today={today}
            weekStart={weekStart}
            placeholder="No due date"
            clearLabel="No due date"
            onPick={(next) => {
              const iso = next ? `${next}T00:00:00.000Z` : null;
              if ((next ?? '') !== day) saveItem(i, { dueDate: iso }, { dueDate: iso });
            }}
            className={`${CHIP} outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand/40 ${tone}`}
          >
            {late ? `Overdue · ${words}` : words}
          </DayPickerButton>
        );
      },
    },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      className: 'w-px whitespace-nowrap',
      cell: (i) =>
        fieldsOf(i).has('status') ? (
          <SearchableSelect
            size="chip"
            ariaLabel={`Status of ${i.description}: ${ACTION_STATUS_LABELS[i.status]}`}
            value={i.status}
            onChange={(v) => v !== i.status && saveItem(i, { status: v as ActionItemStatus }, { status: v as ActionItemStatus })}
            options={ACTION_STATUSES.map((s) => ({ value: s, label: ACTION_STATUS_LABELS[s] }))}
            chipClassName={badgeToneClass(actionStatusTone(i.status))}
          />
        ) : (
          <span className={`${CHIP} ${badgeToneClass(actionStatusTone(i.status))}`}>{ACTION_STATUS_LABELS[i.status]}</span>
        ),
    },
    {
      id: 'open',
      label: 'Open',
      hideLabel: true,
      className: 'w-px !px-1.5 text-end',
      cell: (i) =>
        i.taskId && i.taskKey ? (
          <button
            type="button"
            onClick={() => openTask(i.taskId!)}
            aria-label={`Open ${i.taskKey}: ${i.description}`}
            title="Open its task"
            className={`inline-grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${TOUCH_SQUARE}`}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </button>
        ) : null,
    },
  ];
  const visible = columns.filter((c) => !c.optional || memory.shown.includes(c.id)).map((c) => c.id);

  // ── The groups: each topic (its own row of quick edits), Other, then any from elsewhere ──
  const topicHead = (t: AgendaItem, n: number, count: number): ReactNode => {
    const isFolded = folded.has(t.id);
    const fold = () =>
      setFolded((f) => {
        const next = new Set(f);
        if (next.has(t.id)) next.delete(t.id);
        else next.add(t.id);
        return next;
      });
    const presenter = ownerName(t.ownerId);
    return visible.map((id) => {
      switch (id) {
        case 'title':
          return (
            <th key={id} scope="rowgroup" className={`${CELL} ${PINNED_HEAD_CELL} bg-ground text-start font-normal`}>
              <span className="flex min-w-0 items-start gap-1">
                <button
                  type="button"
                  onClick={fold}
                  aria-expanded={!isFolded}
                  aria-label={`${isFolded ? 'Unfold' : 'Fold'} ${t.title}`}
                  title={isFolded ? 'Show its action items' : 'Hide its action items'}
                  // On a touch screen its 44px target reaches into the cell's padding, leaving the title its room.
                  className={`grid h-6 w-6 flex-none place-items-center rounded text-ink-2 hover:bg-surface hover:text-ink ${TOUCH_SQUARE} [@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:-ms-3`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${isFolded ? '-rotate-90 rtl:rotate-90' : ''}`}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                <span className="mt-0.5 flex-none text-sm font-semibold tabular-nums text-ink-2">{n}.</span>
                <span className="min-w-0 flex-1 text-sm font-semibold">
                  <TitleCell value={t.title} what={`the title of topic ${n}`} editable={agendaEditable} onSave={(next) => saveTopic(t, { title: next })} emptyMessage="An agenda item needs a title." />
                </span>
                {isFolded && count ? (
                  <span className="mt-0.5 flex-none rounded-full bg-surface px-1.5 text-[11px] font-semibold text-ink-2">
                    <span aria-hidden="true">{count}</span>
                    <span className="sr-only">{count === 1 ? '1 action item' : `${count} action items`}</span>
                  </span>
                ) : null}
              </span>
            </th>
          );
        case 'owner':
          return (
            <td key={id} className={CELL}>
              {agendaEditable ? (
                <SearchableSelect
                  size="chip"
                  ariaLabel={`Presenter of topic ${n}: ${presenter ?? 'No presenter'}`}
                  placeholder="No presenter"
                  value={t.ownerId ?? ''}
                  onChange={(v) => (v || null) !== t.ownerId && saveTopic(t, { ownerId: v || null })}
                  options={peopleOptions(directory, 'No presenter')}
                  chipClassName={presenter ? 'bg-surface text-ink' : 'bg-surface text-ink-3'}
                />
              ) : (
                <bdi className={`text-xs ${presenter ? 'text-ink' : 'text-ink-3'}`}>{presenter ?? 'No presenter'}</bdi>
              )}
            </td>
          );
        case 'priority':
          return (
            <td key={id} className={`${CELL} text-ink-3`}>
              <span aria-hidden="true">—</span>
              <span className="sr-only">No priority</span>
            </td>
          );
        case 'due':
          return (
            <td key={id} className={CELL}>
              <MinutesCell value={t.expectedMinutes} what={`the planned minutes of topic ${n}`} editable={agendaEditable} onSave={(m) => saveTopic(t, { expectedMinutes: m })} />
            </td>
          );
        case 'status':
          return (
            <td key={id} className={CELL}>
              {agendaEditable ? (
                <SearchableSelect
                  size="chip"
                  ariaLabel={`Covered, topic ${n}: ${t.completed ? 'Covered ✓' : 'Not covered'}`}
                  value={t.completed ? 'yes' : 'no'}
                  onChange={(v) => (v === 'yes') !== t.completed && saveTopic(t, { completed: v === 'yes' })}
                  options={COVERED}
                  chipClassName={t.completed ? badgeToneClass('success') : 'bg-surface text-ink-2'}
                />
              ) : (
                <span className={`${CHIP} ${t.completed ? badgeToneClass('success') : 'bg-surface text-ink-2'}`}>{t.completed ? 'Covered ✓' : 'Not covered'}</span>
              )}
            </td>
          );
        default:
          return <td key={id} className={CELL} />;
      }
    });
  };
  const plainHead = (label: string, count: number): ReactNode =>
    visible.map((id) =>
      id === 'title' ? (
        <th key={id} scope="rowgroup" className={`${CELL} ${PINNED_HEAD_CELL} bg-ground ps-9 text-start text-sm font-semibold text-ink max-md:ps-3`}>
          {label} <span className="ms-1 text-xs font-medium text-ink-3">{count}</span>
        </th>
      ) : (
        <td key={id} className={CELL} />
      ),
    );

  const grouped = groupActionItems(topics, shownItems, notes);
  const sections: DataSection<ActionItem>[] = [
    ...grouped
      // While a filter is on, a topic with no item that matches steps aside.
      .filter((g) => !filtering || g.items.length > 0)
      .map((g) =>
        g.topic
          ? { key: g.topic.id, head: topicHead(g.topic, g.number!, g.items.length), rows: g.items, collapsed: folded.has(g.topic.id), headClassName: 'bg-ground' }
          : { key: OTHER, head: plainHead('Other', g.items.length), rows: g.items, headClassName: 'bg-ground' },
      ),
    ...extra.filter((g) => g.shown.length > 0 || (!filtering && g.items.length > 0)).map((g) => ({ key: `extra:${g.key}`, head: plainHead(g.label, g.shown.length), rows: g.shown, headClassName: 'bg-ground' })),
  ];

  const loading = agendaQ.isLoading || (!givenItems && itemsQ.isLoading);
  const failed = agendaQ.isError || (!givenItems && itemsQ.isError);
  const total = rawItems.length + allExtra;
  const openCount = rawItems.filter((i) => i.status !== 'COMPLETED' && i.status !== 'CANCELLED').length;

  return (
    <Section id="agenda" title="Agenda and action items" count={total ? `${openCount} open of ${rawItems.length}` : undefined} aside={switcher}>
      {loading ? (
        <div aria-hidden="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((k) => <div key={k} className="skeleton h-10 w-full" />)}
        </div>
      ) : failed ? (
        <LoadError what="the agenda and action items" onRetry={() => void Promise.all([agendaQ.refetch(), itemsQ.refetch()])} />
      ) : (
        <DataTable
          label="Agenda and action items"
          columns={columns}
          sections={sections}
          rowKey={(i) => i.id}
          sort={memory.sort}
          onSort={memory.setSort}
          sortValue={(i, c) => actionItemSortValue(i, c, ownerName, timeZone)}
          shown={memory.shown}
          onShownChange={memory.setShown}
          toolbar={
            <TableFilterBar
              filters={filters}
              onChange={memory.setFilters}
              statusOptions={statusOptions}
              personOptions={personOptions}
              personLabel="owner"
              showDue={false}
              shown={shownItems.length + shownExtra}
              total={total}
              noun={['action item', 'action items']}
            />
          }
          notice={
            <>
              {locked ? (
                <p role="status" data-read-only={locked} className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-3">
                    <rect x="3" y="4" width="18" height="5" rx="1" />
                    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
                  </svg>
                  <span>{READ_ONLY_NOTICE[locked]}</span>
                </p>
              ) : null}
              {itemEdits.error ? <Problem onDismiss={itemEdits.clearError}>{itemEdits.error}</Problem> : null}
              {topicEdits.error ? <Problem onDismiss={topicEdits.clearError}>{topicEdits.error}</Problem> : null}
            </>
          }
          empty={
            filtering ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-line p-6 text-center">
                <p className="text-sm font-semibold text-ink">No action items match these filters</p>
                <button type="button" onClick={() => memory.setFilters({ ...EMPTY_TABLE_FILTERS })} className={`text-sm font-semibold text-brand underline ${TOUCH_TALL}`}>
                  Clear filters
                </button>
              </div>
            ) : (
              <p className="text-sm text-ink-2">No agenda or action items yet.</p>
            )
          }
        />
      )}
      {noChanges ? null : (
        <>
          {agendaEditable ? <AgendaAddForm meetingId={meetingId} directory={directory} /> : null}
          <ActionItemAddForm meetingId={meetingId} directory={directory} timeZone={timeZone} />
        </>
      )}
    </Section>
  );
}

function Problem({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  return (
    <p role="alert" className="mb-2 flex items-start justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      <span>{children}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className={`flex-none rounded px-1 opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>
        ✕
      </button>
    </p>
  );
}
