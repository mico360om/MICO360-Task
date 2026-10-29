import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, type AgendaItem } from '../../api/meetings';
import type { DirectoryUser } from '../../api/users';
import { apiClient } from '../../api/client';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { SearchableSelect } from '../ui/SearchableSelect';
import { SaveIndicator, useSaveState } from '../task-drawer/save-state';
import { ConfirmRemoveButton, Icon, LoadError, Section, SectionError, peopleOptions, userName } from './kit';
import { meetingFailure } from './meeting-actions';
import { agendaTiming } from '../../lib/meeting-flow';
import { aiApi, type AiAgendaItem } from '../../api/ai';
import { AgendaDraftReview } from '../meeting-form/AgendaDraftReview';
import { aiMessage } from '../meeting-form/ai-message';

const minutesValue = (v: string): number | null => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))));

/** The agenda: topics in order, who presents each and how long it should take, against the meeting's length. */
export function AgendaSection({
  meetingId,
  startAt,
  endAt,
  directory,
  canEdit,
  pollMs,
  draftFrom,
}: {
  meetingId: string;
  startAt: string;
  endAt: string | null;
  directory: DirectoryUser[];
  canEdit: boolean;
  pollMs: number | false;
  /** What "Draft agenda" works from (the meeting's details and who is invited, the organizer included). */
  draftFrom?: { title: string; description: string | null; projectId: string | null; peopleIds: string[] };
}) {
  const qc = useQueryClient();
  const [drafted, setDrafted] = useState<AiAgendaItem[] | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const agendaQ = useQuery({ queryKey: ['meeting', meetingId, 'agenda'], queryFn: () => meetingsApi(apiClient).listAgenda(meetingId), enabled: !!meetingId, refetchInterval: pollMs });
  const items = Array.isArray(agendaQ.data) ? agendaQ.data : [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['meeting', meetingId, 'agenda'] });
  const timing = agendaTiming(items, startAt, endAt);

  const addMut = useMutation({
    mutationFn: () => meetingsApi(apiClient).addAgendaItem(meetingId, { title: title.trim(), expectedMinutes: minutesValue(minutes), ownerId: ownerId || null }),
    onSuccess: () => {
      setTitle('');
      setMinutes('');
      setOwnerId('');
      setAddError(null);
      void refresh();
    },
    onError: (err) => setAddError(meetingFailure(err, 'Couldn’t add the agenda item.')),
  });
  const toggleMut = useMutation({
    mutationFn: ({ item, completed }: { item: AgendaItem; completed: boolean }) => meetingsApi(apiClient).updateAgendaItem(meetingId, item.id, { completed }),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t update the agenda item.')),
  });
  const removeMut = useMutation({
    mutationFn: (itemId: string) => meetingsApi(apiClient).removeAgendaItem(meetingId, itemId),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t delete the agenda item.')),
  });
  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => meetingsApi(apiClient).reorderAgenda(meetingId, orderedIds),
    onSuccess: refresh,
    onError: (err) => setOpError(meetingFailure(err, 'Couldn’t reorder the agenda.')),
  });

  // Draft agenda: the AI proposes items; only the ticked ones are added, after the existing ones.
  const draftMut = useMutation({
    mutationFn: () =>
      aiApi(apiClient).draftAgenda({
        title: draftFrom!.title,
        ...(draftFrom!.description?.trim() ? { description: draftFrom!.description.trim() } : {}),
        projectId: draftFrom!.projectId,
        startAt,
        minutes: timing.length ?? 60,
        peopleIds: draftFrom!.peopleIds,
        meetingId,
      }),
    onMutate: () => {
      setDraftError(null);
      setDrafted(null);
    },
    onSuccess: setDrafted,
    onError: (err) => setDraftError(aiMessage(err, 'Couldn’t draft an agenda. Try again, or add the items yourself.')),
  });
  const addDraftedMut = useMutation({
    mutationFn: async (chosen: AiAgendaItem[]) => {
      for (const item of chosen) await meetingsApi(apiClient).addAgendaItem(meetingId, { title: item.title, ownerId: item.ownerId, expectedMinutes: item.minutes });
    },
    onSuccess: () => {
      setDrafted(null);
      void refresh();
    },
    onError: (err) => {
      setDraftError(meetingFailure(err, 'Couldn’t add all of the drafted items.'));
      void refresh();
    },
  });

  function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= items.length) return;
    const ids = items.map((i) => i.id);
    const moved = ids.splice(index, 1)[0]!;
    ids.splice(next, 0, moved);
    reorderMut.mutate(ids);
  }

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!title.trim()) {
      setAddError('Enter an agenda item.');
      return;
    }
    addMut.mutate();
  }

  const total =
    items.length === 0 ? null : (
      <span className={`text-xs ${timing.over ? 'font-medium text-warning' : 'text-ink-3'}`}>
        {timing.length !== null ? `${timing.planned} of ${timing.length} min planned` : `${timing.planned} min planned`}
        {timing.over ? ` · ${timing.over} min over` : ''}
      </span>
    );

  return (
    <Section id="agenda" title="Agenda" count={items.length || undefined} aside={total}>
      <SectionError message={opError} onDismiss={() => setOpError(null)} />
      {agendaQ.isLoading ? (
        <div className="skeleton h-16 w-full" />
      ) : agendaQ.isError ? (
        <LoadError what="the agenda" onRetry={() => void agendaQ.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-2">{canEdit ? 'No agenda yet. Add the topics you plan to cover, who presents each and for how long.' : 'No agenda yet.'}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {items.map((item, index) =>
            editing === item.id ? (
              <li key={item.id} className="py-2.5">
                <AgendaEditRow meetingId={meetingId} item={item} directory={directory} onDone={() => { setEditing(null); void refresh(); }} />
              </li>
            ) : (
              // The topic wraps (never cut short); on a narrow screen the buttons move under it, to the end.
              <li key={item.id} className="flex items-start gap-1.5 py-2">
                <span className="mt-2.5 w-5 shrink-0 text-right text-xs tabular-nums text-ink-3">{index + 1}</span>
                {/* The tick box's label is the finger-sized target around it (the box itself stays 16px). */}
                <label className={`-my-0.5 grid h-10 w-8 shrink-0 place-items-center ${canEdit ? 'cursor-pointer' : ''} [@media(pointer:coarse)]:w-11`}>
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={!canEdit}
                    onChange={(e) => toggleMut.mutate({ item, completed: e.target.checked })}
                    aria-label={`Covered: "${item.title}"`}
                    className="h-4 w-4 accent-[color:rgb(var(--c-brand))]"
                  />
                </label>
                <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-0.5">
                <div className="min-w-0 flex-[1_1_12rem] pt-2">
                  <span className={`block text-sm font-medium leading-snug [overflow-wrap:anywhere] ${item.completed ? 'text-ink-3 line-through' : 'text-ink'}`}>
                    <bdi>{item.title}</bdi>
                  </span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                    <span>{userName(directory, item.ownerId) ? <bdi>{userName(directory, item.ownerId)}</bdi> : 'No presenter'}</span>
                    <span>· {item.expectedMinutes != null ? `${item.expectedMinutes} min` : 'no time set'}</span>
                  </div>
                </div>
                {canEdit ? (
                  <div className="ms-auto flex shrink-0 items-center">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || reorderMut.isPending} aria-label={`Move "${item.title}" up`} className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink disabled:opacity-30 sm:h-8 sm:w-8">{Icon.up}</button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1 || reorderMut.isPending} aria-label={`Move "${item.title}" down`} className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink disabled:opacity-30 sm:h-8 sm:w-8">{Icon.down}</button>
                    <button type="button" onClick={() => setEditing(item.id)} aria-label={`Edit "${item.title}"`} className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink sm:h-8 sm:w-8">{Icon.edit}</button>
                    <ConfirmRemoveButton label={`Remove "${item.title}"`} onConfirm={() => removeMut.mutate(item.id)} disabled={removeMut.isPending} />
                  </div>
                ) : null}
                </div>
              </li>
            ),
          )}
        </ol>
      )}

      {canEdit && draftFrom ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => draftMut.mutate()}
            disabled={draftMut.isPending}
            className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2z" /></svg>
            {draftMut.isPending ? 'Drafting…' : 'Draft agenda'}
          </button>
          {draftError ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{draftError}</p> : null}
          {drafted ? (
            <AgendaDraftReview
              items={drafted}
              leadName={(owner) => userName(directory, owner) || null}
              onAdd={(chosen) => addDraftedMut.mutate(chosen)}
              onDismiss={() => setDrafted(null)}
              busy={addDraftedMut.isPending}
            />
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={submitAdd} className="mt-3 grid grid-cols-[minmax(0,1fr)_5.5rem_auto] gap-2 border-t border-line pt-3">
          <input aria-label="New agenda item" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a topic…" className={`${fieldClass(!!addError)} col-span-full`} />
          <SearchableSelect ariaLabel="Presenter for the new item" placeholder="Presenter" options={peopleOptions(directory, 'No presenter')} value={ownerId} onChange={setOwnerId} />
          <input aria-label="Minutes for the new item" type="number" inputMode="numeric" min={0} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="min" className={fieldClass(false)} />
          <Button type="submit" size="sm" loading={addMut.isPending}>Add</Button>
          {addError ? <p role="alert" className="col-span-full text-xs font-medium text-danger">{addError}</p> : null}
        </form>
      ) : null}
    </Section>
  );
}

function AgendaEditRow({ meetingId, item, directory, onDone }: { meetingId: string; item: AgendaItem; directory: DirectoryUser[]; onDone: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [ownerId, setOwnerId] = useState(item.ownerId ?? '');
  const [minutes, setMinutes] = useState(item.expectedMinutes != null ? String(item.expectedMinutes) : '');
  const save = useSaveState();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      save.fail('An agenda item needs a title.');
      return;
    }
    const ok = await save.run(() =>
      meetingsApi(apiClient).updateAgendaItem(meetingId, item.id, { title: title.trim(), ownerId: ownerId || null, expectedMinutes: minutesValue(minutes) }).catch((err) => {
        throw new Error(meetingFailure(err, 'Couldn’t save the agenda item.'));
      }),
    );
    if (ok) onDone();
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_5.5rem]"
    >
      <input aria-label="Agenda item title" dir="auto" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass(save.state.status === 'error')} />
      <SearchableSelect ariaLabel="Presenter" placeholder="Presenter" options={peopleOptions(directory, 'No presenter')} value={ownerId} onChange={setOwnerId} />
      <input aria-label="Planned minutes" type="number" inputMode="numeric" min={0} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="min" className={fieldClass(false)} />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit" size="sm" loading={save.busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={save.busy}>Cancel</Button>
        <SaveIndicator state={save.state} />
      </div>
    </form>
  );
}
