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
import { ConfirmRemoveButton, Icon, LoadError, Section, SectionError, peopleOptions } from './kit';
import { meetingFailure } from './meeting-actions';
import { formatDueDate, isActionItemOverdue } from '../../lib/meetingFormat';
import { dueDayKey } from '../../lib/due-date';

const STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

// An item's controls wrap by the room the section really has (beside the side column on a laptop,
// full width on a tablet): owner + due date, then priority + status, side by side when both pairs fit.
// A fixed four-column row squeezed the owner to a letter at 768–1279px.
const PAIRS = 'flex flex-wrap gap-2';
const PAIR_A = 'flex min-w-0 flex-[1_1_21.5rem] flex-wrap gap-2';
const PAIR_B = 'flex min-w-0 flex-[1_1_15.5rem] flex-wrap gap-2';
const OWNER = 'min-w-0 flex-[1_1_12rem]';
const DATE = 'min-w-0 flex-[1_1_9rem]';
const PRIORITY = 'min-w-0 flex-[1_1_7rem]';
const small = `${fieldClass(false)} !min-h-9 !py-1 text-xs`;

/** Follow-ups from the meeting: who owns each, by when, how urgent, where it stands — and its task. */
export function ActionItemsSection({
  meetingId,
  directory,
  canEdit,
  pollMs,
  timeZone,
}: {
  meetingId: string;
  directory: DirectoryUser[];
  canEdit: boolean;
  pollMs: number | false;
  timeZone: string;
}) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
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
              canRemove={canEdit || item.createdById === myId}
              onChange={(patch) => updateMut.mutate({ id: item.id, patch })}
              onRemove={() => removeMut.mutate(item.id)}
              removing={removeMut.isPending}
            />
          ))}
        </ul>
      )}

      <form onSubmit={submitAdd} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <input aria-label="New action item" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be done?" className={fieldClass(!!addError)} />
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
  canRemove,
  onChange,
  onRemove,
  removing,
}: {
  item: ActionItem;
  directory: DirectoryUser[];
  timeZone: string;
  canRemove: boolean;
  onChange: (patch: ActionItemPatch) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const done = item.status === 'COMPLETED' || item.status === 'CANCELLED';
  const overdue = isActionItemOverdue(item, timeZone);
  const day = dueDayKey(item.dueDate, timeZone) ?? '';
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${done ? 'text-ink-3 line-through' : 'text-ink'}`}><bdi>{item.description}</bdi></p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
            {item.dueDate ? (
              <span className={overdue ? 'font-medium text-danger' : ''}>Due {formatDueDate(item.dueDate, timeZone)}{overdue ? ' — overdue' : ''}</span>
            ) : (
              <span>No due date</span>
            )}
            {item.sourceNoteId ? <span>· From a note</span> : null}
            {item.taskId ? (
              <Link to={`?task=${encodeURIComponent(item.taskId)}`} className="inline-flex min-h-7 items-center gap-1 rounded-full bg-success-soft px-2 font-medium text-success hover:brightness-95">
                {Icon.task} {item.taskKey ?? 'Task'}
                <span className="sr-only"> — open the linked task</span>
              </Link>
            ) : null}
          </div>
        </div>
        {canRemove ? <ConfirmRemoveButton label={`Remove ${item.description}`} onConfirm={onRemove} disabled={removing} /> : null}
      </div>
      <div className={`mt-2 ${PAIRS}`}>
        <div className={PAIR_A}>
          <SearchableSelect ariaLabel={`Owner of ${item.description}`} className={OWNER} placeholder="Unassigned" options={peopleOptions(directory, 'Unassigned')} value={item.assigneeId ?? ''} onChange={(v) => onChange({ assigneeId: v || null })} />
          <input aria-label={`Due date for ${item.description}`} type="date" value={day} onChange={(e) => onChange({ dueDate: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })} className={`${small} ${DATE}`} />
        </div>
        <div className={PAIR_B}>
          <select aria-label={`Priority for ${item.description}`} value={item.priority} onChange={(e) => onChange({ priority: e.target.value as Priority })} className={`${small} ${PRIORITY}`}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
          <select aria-label={`Status for ${item.description}`} value={item.status} onChange={(e) => onChange({ status: e.target.value as ActionItemStatus })} className={`${small} min-w-0 flex-[1_1_8rem]`}>
            {STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>
    </li>
  );
}
