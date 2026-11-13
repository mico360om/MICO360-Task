import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { MEETING_STATUS_LABELS, type Meeting } from '../../../api/meetings';
import { meetingSeriesApi, type SeriesPage } from '../../../api/meeting-series';
import { useDialog } from '../../../hooks/useDialog';
import { ModalPortal } from '../../ui/ModalPortal';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FieldLabel, fieldClass } from '../../ui/Field';
import { dialogLayer, dialogPanel } from '../../ui/dialog-size';
import { meetingFailure } from '../meeting-actions';
import { seriesDay } from '../../../lib/meeting-series';

const NAME_MAX = 200;

/** After a series change: every view of meetings and series reads again. */
function useSeriesRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['meetings'] });
    void qc.invalidateQueries({ queryKey: ['meeting'] });
    void qc.invalidateQueries({ queryKey: ['meeting-series'] });
  };
}

/** A small window with a form: a title, its fields, and Cancel / the main button. */
function SmallFormDialog({
  title,
  busy,
  error,
  confirmLabel,
  canConfirm = true,
  onSubmit,
  onClose,
  children,
  size = 'small',
}: {
  title: string;
  busy: boolean;
  error: string | null;
  confirmLabel: string;
  canConfirm?: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
  size?: 'small' | 'form';
}) {
  const titleId = useId();
  const dialogRef = useDialog(busy ? () => {} : onClose);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && canConfirm) onSubmit();
  };
  return (
    <ModalPortal>
      <div className={dialogLayer(size)}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`card relative flex ${dialogPanel(size)} animate-scale-in flex-col overflow-hidden`}>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
              <h2 id={titleId} className="font-display text-lg font-semibold text-ink">{title}</h2>
              {children}
              {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
            </div>
            <div className="flex flex-none flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy} shortcut="cancel">Cancel</Button>
              <Button type="submit" loading={busy} disabled={!canConfirm}>{confirmLabel}</Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function NameField({ id, value, onChange, label = 'Series name' }: { id: string; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} required>{label}</FieldLabel>
      <input id={id} dir="auto" value={value} maxLength={NAME_MAX} onChange={(e) => onChange(e.target.value)} placeholder="Monthly site review" className={fieldClass(false)} />
    </div>
  );
}

/**
 * "Add to a series…" on a meeting: one of its project's series, or "New series…" (named after the
 * meeting). A repeating meeting brings all its meetings — said before it is done.
 */
export function AddToSeriesDialog({ meeting, onClose, onDone }: { meeting: Meeting; onClose: () => void; onDone?: (seriesName: string) => void }) {
  const refresh = useSeriesRefresh();
  const nameId = useId();
  const optionsQ = useQuery({ queryKey: ['meeting', meeting.id, 'series-options'], queryFn: () => meetingSeriesApi(apiClient).options(meeting.id), staleTime: 0 });
  const opts = optionsQ.data;
  const [choice, setChoice] = useState<string>('new');
  const [name, setName] = useState(meeting.title);
  const chosen = choice === 'new' ? null : opts?.series.find((s) => s.id === choice) ?? null;
  const mut = useMutation({
    mutationFn: async () => {
      const api = meetingSeriesApi(apiClient);
      const wholeFamily = !!opts?.repeats;
      if (choice === 'new') return (await api.create({ name: name.trim(), meetingId: meeting.id, wholeFamily })).name;
      await api.addMeetings(choice, [meeting.id], wholeFamily);
      return chosen?.name ?? '';
    },
    onSuccess: (seriesName) => {
      refresh();
      onDone?.(seriesName);
      onClose();
    },
  });
  const blankName = choice === 'new' && !name.trim();
  const many = opts?.repeats ? opts.familySize : 1;
  return (
    <SmallFormDialog
      title="Add to a series"
      busy={mut.isPending}
      error={mut.isError ? meetingFailure(mut.error, 'Couldn’t add the meeting to the series.') : optionsQ.isError ? 'Couldn’t load the series of this project. Close and try again.' : null}
      confirmLabel={many > 1 ? `Add all ${many} meetings` : 'Add to series'}
      canConfirm={!!opts?.canChange && !blankName}
      onSubmit={() => mut.mutate()}
      onClose={onClose}
    >
      {optionsQ.isLoading ? <p role="status" className="text-sm text-ink-3">Loading…</p> : null}
      {opts && !opts.canChange ? <p className="text-sm text-ink-2">Only the meeting’s organizer, the project’s managers or an administrator can add it to a series.</p> : null}
      {opts?.canChange ? (
        <>
          {opts.repeats ? (
            <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
              This meeting repeats — all its {opts.familySize} meetings will be added{opts.current ? <>, and leave their own series “<bdi>{opts.current.name}</bdi>”</> : null}.
            </p>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Which series?</legend>
            {opts.series.map((s) => (
              <label key={s.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${choice === s.id ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/50'}`}>
                <input type="radio" name="series-choice" value={s.id} checked={choice === s.id} onChange={() => setChoice(s.id)} className="accent-[rgb(var(--c-brand))]" />
                <bdi className="min-w-0 text-sm font-medium text-ink">{s.name}</bdi>
              </label>
            ))}
            <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${choice === 'new' ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/50'}`}>
              <input type="radio" name="series-choice" value="new" checked={choice === 'new'} onChange={() => setChoice('new')} className="accent-[rgb(var(--c-brand))]" />
              <span className="text-sm font-medium text-ink">New series…</span>
            </label>
          </fieldset>
          {choice === 'new' ? <NameField id={nameId} value={name} onChange={setName} /> : null}
        </>
      ) : null}
    </SmallFormDialog>
  );
}

/** "Remove from series": the meeting (a repeat: its whole family) leaves the series; nothing else changes. */
export function RemoveFromSeriesDialog({
  series,
  meetingId,
  repeats,
  onClose,
  onDone,
}: {
  series: { id: string; name: string };
  meetingId: string;
  /** It repeats: its whole family leaves together. */
  repeats: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const refresh = useSeriesRefresh();
  const mut = useMutation({
    mutationFn: () => meetingSeriesApi(apiClient).removeMeeting(series.id, meetingId),
    onSuccess: () => {
      refresh();
      onDone?.();
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title="Remove from the series?"
      confirmLabel="Remove from series"
      keepLabel="Keep it"
      busy={mut.isPending}
      error={mut.isError ? meetingFailure(mut.error, 'Couldn’t remove the meeting from the series.') : null}
      onConfirm={() => mut.mutate()}
      onClose={onClose}
    >
      {repeats ? (
        <p>This meeting repeats: all its meetings leave “<bdi>{series.name}</bdi>” together and get a series of their own. The meetings themselves don’t change.</p>
      ) : (
        <p>This meeting leaves “<bdi>{series.name}</bdi>”. The meeting itself doesn’t change.</p>
      )}
    </ConfirmDialog>
  );
}

/** Rename a series. */
export function RenameSeriesDialog({ series, onClose }: { series: { id: string; name: string }; onClose: () => void }) {
  const refresh = useSeriesRefresh();
  const nameId = useId();
  const [name, setName] = useState(series.name);
  const mut = useMutation({
    mutationFn: () => meetingSeriesApi(apiClient).rename(series.id, name.trim()),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <SmallFormDialog
      title="Rename the series"
      busy={mut.isPending}
      error={mut.isError ? meetingFailure(mut.error, 'Couldn’t rename the series.') : null}
      confirmLabel="Save"
      canConfirm={!!name.trim() && name.trim() !== series.name}
      onSubmit={() => mut.mutate()}
      onClose={onClose}
    >
      <NameField id={nameId} value={name} onChange={setName} />
    </SmallFormDialog>
  );
}

/** "Merge another series into this one": its meetings come here, and it goes. */
export function MergeSeriesDialog({ page, onClose, onDone }: { page: SeriesPage; onClose: () => void; onDone?: (mergedName: string) => void }) {
  const refresh = useSeriesRefresh();
  const [choice, setChoice] = useState(page.mergeOptions[0]?.id ?? '');
  const other = page.mergeOptions.find((s) => s.id === choice) ?? null;
  const mut = useMutation({
    mutationFn: () => meetingSeriesApi(apiClient).merge(page.series.id, choice),
    onSuccess: () => {
      refresh();
      onDone?.(other?.name ?? '');
      onClose();
    },
  });
  return (
    <SmallFormDialog
      title="Merge another series into this one"
      busy={mut.isPending}
      error={mut.isError ? meetingFailure(mut.error, 'Couldn’t merge the series.') : null}
      confirmLabel="Merge"
      canConfirm={!!other}
      onSubmit={() => mut.mutate()}
      onClose={onClose}
    >
      {page.mergeOptions.length === 0 ? (
        <p className="text-sm text-ink-2">There is no other series of this project to merge.</p>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Which series?</legend>
            {page.mergeOptions.map((s) => (
              <label key={s.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${choice === s.id ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/50'}`}>
                <input type="radio" name="merge-choice" value={s.id} checked={choice === s.id} onChange={() => setChoice(s.id)} className="accent-[rgb(var(--c-brand))]" />
                <bdi className="min-w-0 text-sm font-medium text-ink">{s.name}</bdi>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-ink-2">
            Its meetings join “<bdi>{page.series.name}</bdi>”{other ? <>, and “<bdi>{other.name}</bdi>” goes</> : null}. The meetings themselves don’t change.
          </p>
        </>
      )}
    </SmallFormDialog>
  );
}

/** "Add existing meetings": the project's meetings in no series that this person may add. */
export function AddExistingMeetingsDialog({ seriesId, seriesName, timeZone, onClose, onDone }: { seriesId: string; seriesName: string; timeZone: string; onClose: () => void; onDone?: (count: number) => void }) {
  const refresh = useSeriesRefresh();
  const q = useQuery({ queryKey: ['meeting-series', seriesId, 'candidates'], queryFn: () => meetingSeriesApi(apiClient).candidates(seriesId), staleTime: 0 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const list = Array.isArray(q.data) ? q.data : [];
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const mut = useMutation({
    mutationFn: () => meetingSeriesApi(apiClient).addMeetings(seriesId, [...picked]),
    onSuccess: () => {
      refresh();
      onDone?.(picked.size);
      onClose();
    },
  });
  return (
    <SmallFormDialog
      size="form"
      title={`Add meetings to “${seriesName}”`}
      busy={mut.isPending}
      error={mut.isError ? meetingFailure(mut.error, 'Couldn’t add the meetings.') : q.isError ? 'Couldn’t load the meetings. Close and try again.' : null}
      confirmLabel={picked.size > 1 ? `Add ${picked.size} meetings` : 'Add meeting'}
      canConfirm={picked.size > 0}
      onSubmit={() => mut.mutate()}
      onClose={onClose}
    >
      <p className="text-sm text-ink-2">Meetings of this project that aren’t in a series yet. A repeating meeting is in a series of its own — merge that series instead.</p>
      {q.isLoading ? <p role="status" className="text-sm text-ink-3">Loading…</p> : null}
      {q.isSuccess && list.length === 0 ? <p className="text-sm text-ink-3">There are no meetings to add.</p> : null}
      {list.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" aria-label="Meetings to add">
          {list.map((m) => (
            <li key={m.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-ground/60">
                <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4 accent-[rgb(var(--c-brand))]" />
                <span className="w-24 flex-none text-sm tabular-nums text-ink-2">{seriesDay(m.startAt, timeZone)}</span>
                <bdi className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{m.title}</bdi>
                {m.status !== 'SCHEDULED' ? <span className="flex-none text-xs text-ink-3">{MEETING_STATUS_LABELS[m.status]}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </SmallFormDialog>
  );
}

/** Delete a series: its meetings stay as they are. */
export function DeleteSeriesDialog({ page, onClose, onDone }: { page: SeriesPage; onClose: () => void; onDone: () => void }) {
  const refresh = useSeriesRefresh();
  const mut = useMutation({
    mutationFn: () => meetingSeriesApi(apiClient).remove(page.series.id),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const repeats = page.meetings.some((m) => m.repeats);
  return (
    <ConfirmDialog
      title="Delete this series?"
      confirmLabel="Delete series"
      keepLabel="Keep it"
      busy={mut.isPending}
      error={mut.isError ? meetingFailure(mut.error, 'Couldn’t delete the series.') : null}
      onConfirm={() => mut.mutate()}
      onClose={onClose}
    >
      <p>
        “<bdi>{page.series.name}</bdi>” goes; its meetings stay as they are.{repeats ? ' Each repeating meeting in it gets a series of its own.' : ''}
      </p>
    </ConfirmDialog>
  );
}
