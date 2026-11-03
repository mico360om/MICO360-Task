import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { meetingsApi, ACTION_STATUS_LABELS, type ActionItem, type ActionItemPatch, type ActionItemStatus, type Priority } from '../../api/meetings';
import type { DirectoryUser } from '../../api/users';
import { apiClient } from '../../api/client';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ConfirmRemoveButton, Icon, LoadError, Section, SectionError, ShrunkSection, peopleOptions, userName } from './kit';
import { meetingFailure } from './meeting-actions';
import { actionStatusTone, isActionItemOverdue } from '../../lib/meetingFormat';
import { dueDayKey, todayKey } from '../../lib/due-date';
import { dayText } from '../../lib/day-words';
import { useDateSettings } from '../../lib/useDatePrefs';
import { TOUCH_TALL } from '../../lib/touch';
import type { WeekStart } from '../../lib/calendar';
import { badgeToneClass, type BadgeTone } from '../ui/Badge';
import { DayPickerButton } from '../ui/DateTimeField';

const STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const PRIORITY_TONE: Record<Priority, BadgeTone> = { LOW: 'neutral', NORMAL: 'info', HIGH: 'warning', URGENT: 'danger' };
/** A row's other chips (the due date, From a note, the task): the select chips' look. */
const CHIP = 'inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-xs font-medium';

// An item's controls wrap by the room the section really has (beside the side column on a laptop,
// full width on a tablet): owner + due date, then priority + status, side by side when both pairs fit.
// A fixed four-column row squeezed the owner to a letter at 768–1279px.
const PAIRS = 'flex flex-wrap gap-2';
const PAIR_A = 'flex min-w-0 flex-[1_1_21.5rem] flex-wrap gap-2';
const PAIR_B = 'flex min-w-0 flex-[1_1_15.5rem] flex-wrap gap-2';
const OWNER = 'min-w-0 flex-[1_1_12rem]';
const DATE = 'min-w-0 flex-[1_1_9rem]';
const PRIORITY = 'min-w-0 flex-[1_1_7rem]';

/** Follow-ups from the meeting: who owns each, by when, how urgent, where it stands — and its task. */
export function ActionItemsSection({
  meetingId,
  directory,
  canEdit,
  pollMs,
  timeZone,
  ended = false,
}: {
  meetingId: string;
  directory: DirectoryUser[];
  canEdit: boolean;
  pollMs: number | false;
  timeZone: string;
  /** The meeting is over: with no items the section shrinks to one line. */
  ended?: boolean;
}) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const { weekStart } = useDateSettings();
  const today = todayKey(timeZone);
  // Opened by hand from its one-line form (a finished meeting with none): the item box takes focus.
  const [opened, setOpened] = useState(false);
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [addError, setAddError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const itemsQ = useQuery({ queryKey: ['meeting', meetingId, 'action-items'], queryFn: () => meetingsApi(apiClient).listActionItems(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  const items = Array.isArray(itemsQ.data) ? itemsQ.data : [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'action-items'] });
    void qc.invalidateQueries({ queryKey: ['my-action-items'] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
  };
  const openCount = items.filter((i) => i.status !== 'COMPLETED' && i.status !== 'CANCELLED').length;

  const addMut = useMutation({
    // A due date is a calendar day: send the picked day itself (stored as that day, UTC midnight).
    mutationFn: () => meetingsApi(apiClient).addActionItem(meetingId, { description: description.trim(), assigneeId: assigneeId || null, dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null, priority }),
    onSuccess: () => {
      setDescription('');
      setAssigneeId('');
      setDueDate('');
      setPriority('NORMAL');
      setAddError(null);
      refresh();
    },
    onError: (err) => setAddError(meetingFailure(err, 'Couldn’t add the action item.')),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ActionItemPatch }) => meetingsApi(apiClient).updateActionItem(id, patch),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t save the change to the action item.')),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => meetingsApi(apiClient).removeActionItem(id),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t delete the action item.')),
  });

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!description.trim()) {
      setAddError('Describe the action item.');
      return;
    }
    addMut.mutate();
  }

  // A finished meeting with no action items: one line, until someone adds one.
  if (ended && !opened && itemsQ.isSuccess && items.length === 0) {
    return <ShrunkSection id="actions" title="Action items" empty="No action items" addLabel="Add one" onAdd={() => setOpened(true)} />;
  }

  return (
    <Section id="actions" title="Action items" count={items.length ? `${openCount} open of ${items.length}` : undefined}>
      <SectionError message={opError} onDismiss={() => setOpError(null)} />
      {itemsQ.isLoading ? (
        // About two items' height (words, then their owner, date, priority and status).
        <div aria-hidden="true" className="flex flex-col gap-3">
          {[0, 1].map((i) => <div key={i} className="skeleton h-24 w-full" />)}
        </div>
      ) : itemsQ.isError ? (
        <LoadError what="the action items" onRetry={() => void itemsQ.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-2">No action items yet. Add them here, or turn an action note into a task.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => (
            <ActionItemRow
              key={item.id}
              item={item}
              directory={directory}
              timeZone={timeZone}
              today={today}
              weekStart={weekStart}
              canRemove={canEdit || item.createdById === myId}
              onChange={(patch) => updateMut.mutate({ id: item.id, patch })}
              onRemove={() => removeMut.mutate(item.id)}
              removing={removeMut.isPending}
            />
          ))}
        </ul>
      )}

      <form onSubmit={submitAdd} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <input aria-label="New action item" autoFocus={opened} dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be done?" className={fieldClass(!!addError)} />
        <div className={PAIRS}>
          <div className={PAIR_A}>
            <SearchableSelect ariaLabel="Owner of the new item" className={OWNER} placeholder="Owner" options={peopleOptions(directory, 'Unassigned')} value={assigneeId} onChange={setAssigneeId} />
            <input aria-label="Due date of the new item" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${fieldClass(false)} ${DATE}`} />
          </div>
          <div className={PAIR_B}>
            <select aria-label="Priority of the new item" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={`${fieldClass(false)} ${PRIORITY}`}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            <Button type="submit" size="sm" loading={addMut.isPending} className="flex-none">Add</Button>
          </div>
        </div>
        {addError ? <p role="alert" className="text-xs font-medium text-danger">{addError}</p> : null}
      </form>
    </Section>
  );
}

function ActionItemRow({
  item,
  directory,
  timeZone,
  today,
  weekStart,
  canRemove,
  onChange,
  onRemove,
  removing,
}: {
  item: ActionItem;
  directory: DirectoryUser[];
  timeZone: string;
  today: string;
  weekStart: WeekStart;
  canRemove: boolean;
  onChange: (patch: ActionItemPatch) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const done = item.status === 'COMPLETED' || item.status === 'CANCELLED';
  const overdue = isActionItemOverdue(item, timeZone);
  const day = dueDayKey(item.dueDate, timeZone) ?? '';
  const owner = userName(directory, item.assigneeId);
  const d = item.description;
  // One line: the item, then a chip for each of its facts; a chip is clicked to change it (the same
  // rules and saving as before). Done items are struck through and quieter.
  return (
    <li className={`flex items-start gap-2 py-2 ${done ? 'opacity-70' : ''}`}>
      {/* The item and its chips wrap together; the ✕ stays at the end of the first line. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
      <p className={`min-w-0 flex-[1_1_14rem] text-sm [overflow-wrap:anywhere] ${done ? 'text-ink-3 line-through' : 'text-ink'}`}><bdi>{d}</bdi></p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <SearchableSelect
          size="chip"
          ariaLabel={`Owner of ${d}: ${owner ?? 'Unassigned'}`}
          placeholder="Unassigned"
          options={peopleOptions(directory, 'Unassigned')}
          value={item.assigneeId ?? ''}
          onChange={(v) => onChange({ assigneeId: v || null })}
          chipClassName={owner ? 'bg-ground text-ink' : 'bg-ground text-ink-3'}
        />
        <DayPickerButton
          ariaLabel={`Due date for ${d}: ${day ? dayText(day) : 'No due date'}${overdue ? ', overdue' : ''}`}
          value={day}
          today={today}
          weekStart={weekStart}
          placeholder="No due date"
          clearLabel="No due date"
          onPick={(next) => onChange({ dueDate: next ? `${next}T00:00:00.000Z` : null })}
          className={`${CHIP} ${overdue ? 'bg-danger-soft font-semibold text-danger' : day ? 'bg-ground text-ink' : 'bg-ground text-ink-3'}`}
        >
          {day ? dayText(day) : 'No due date'}
          {overdue ? <span> · overdue</span> : null}
        </DayPickerButton>
        <SearchableSelect
          size="chip"
          ariaLabel={`Priority for ${d}: ${PRIORITY_LABEL[item.priority]}`}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          value={item.priority}
          onChange={(v) => onChange({ priority: v as Priority })}
          chipClassName={badgeToneClass(PRIORITY_TONE[item.priority])}
        />
        <SearchableSelect
          size="chip"
          ariaLabel={`Status for ${d}: ${ACTION_STATUS_LABELS[item.status]}`}
          options={STATUSES.map((s) => ({ value: s, label: ACTION_STATUS_LABELS[s] }))}
          value={item.status}
          onChange={(v) => onChange({ status: v as ActionItemStatus })}
          chipClassName={badgeToneClass(actionStatusTone(item.status))}
        />
        {item.sourceNoteId ? <span className={`${CHIP} bg-ground text-ink-2`}>From a note</span> : null}
        {item.taskId ? (
          <Link to={`?task=${encodeURIComponent(item.taskId)}`} className={`${CHIP} bg-success-soft text-success hover:brightness-95 ${TOUCH_TALL}`}>
            {Icon.task} {item.taskKey ?? 'Task'}
            <span className="sr-only"> — open the linked task</span>
          </Link>
        ) : null}
      </div>
      </div>
      {canRemove ? <ConfirmRemoveButton label={`Remove ${d}`} onConfirm={onRemove} disabled={removing} /> : null}
    </li>
  );
}
