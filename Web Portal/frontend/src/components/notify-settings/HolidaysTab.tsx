import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { notificationSettingsApi, type ApiHoliday } from '../../api/notification-settings';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { shortDay } from '../../lib/useWorkingTime';
import { Panel, inputClass, problemOf, settingsKey, type TabProps } from './shared';

const dayWithYear = (key: string) => `${shortDay(key)} ${key.slice(0, 4)}`;

/**
 * Holidays: the company's days off — the starter list of Oman's public holidays (Islamic ones with the
 * expected date until confirmed) and the company's own days off, one-off or every year. Reminders wait
 * for the next working morning on them, and they don't count as working days.
 */
/** Only what changed is sent: moving the day makes an expected date the announced one; a rename doesn't. */
export function changedOf(h: { day: string; name: string; recurring: boolean }, e: { day: string; name: string; recurring: boolean }): { day?: string; name?: string; recurring?: boolean } {
  return { ...(e.day !== h.day ? { day: e.day } : {}), ...(e.name !== h.name ? { name: e.name } : {}), ...(e.recurring !== h.recurring ? { recurring: e.recurring } : {}) };
}

export function HolidaysTab({ companyId, data }: TabProps) {
  const qc = useQueryClient();
  const api = notificationSettingsApi(apiClient);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState({ day: '', name: '', recurring: false });
  const [editing, setEditing] = useState<{ id: string; day: string; name: string; recurring: boolean } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: settingsKey(companyId) });
    await qc.invalidateQueries({ queryKey: ['working-time'] });
  };
  const begin = () => {
    setProblem(null);
    setNote(null);
  };
  const failed = (e: unknown) => setProblem(problemOf(e, 'Couldn’t save that. Please try again.'));

  const add = useMutation({
    mutationFn: () => api.addHoliday(companyId, draft),
    onMutate: begin,
    onSuccess: async () => {
      await refresh();
      setDraft({ day: '', name: '', recurring: false });
      setNote('Day off added.');
    },
    onError: failed,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Partial<Pick<ApiHoliday, 'day' | 'name' | 'recurring' | 'expected'>> }) => api.updateHoliday(companyId, v.id, v.patch),
    onMutate: begin,
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      setNote('Saved.');
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeHoliday(companyId, id),
    onMutate: begin,
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
      setNote('Day off removed.');
    },
    onError: failed,
  });
  const starter = useMutation({
    mutationFn: (year: number) => api.addStarterYear(companyId, year),
    onMutate: begin,
    onSuccess: async (r) => {
      await refresh();
      setNote(r.added ? `${r.added} public holiday${r.added === 1 ? '' : 's'} added.` : 'Those holidays are all here already.');
    },
    onError: failed,
  });

  const thisYear = Number(new Date().toISOString().slice(0, 4));
  const years = [...new Set([thisYear, thisYear + 1, ...data.holidays.map((h) => Number(h.day.slice(0, 4)))])].sort((a, b) => a - b);
  const byYear = (y: number) => data.holidays.filter((h) => Number(h.day.slice(0, 4)) === y);

  const submitAdd = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.day)) return setProblem('Choose the day.');
    if (!draft.name.trim()) return setProblem('Give the day off a name.');
    add.mutate();
  };

  return (
    <div className="grid gap-4">
      {data.banners.map((b) => (
        <p key={`${b.name}${b.year}`} className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-ink">
          <span className="font-semibold">{b.text}:</span> it is set to {dayWithYear(b.day)}, the expected day. Move it to the announced day, or confirm it below.
        </p>
      ))}
      <Panel title="Add a day off" id="nst-holiday-add">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Day
            <input type="date" value={draft.day} onChange={(e) => setDraft((d) => ({ ...d, day: e.target.value }))} className={inputClass} />
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-medium text-ink-2">
            Name
            <input type="text" maxLength={120} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Company day off" className={inputClass} />
          </label>
          <div className="flex items-center gap-2 text-sm text-ink">
            <Toggle on={draft.recurring} onChange={() => setDraft((d) => ({ ...d, recurring: !d.recurring }))} label="Every year" />
            <span aria-hidden="true">Every year</span>
          </div>
          <Button onClick={submitAdd} disabled={add.isPending} className="[@media(pointer:coarse)]:!min-h-11">
            Add
          </Button>
        </div>
        {problem ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
        {note ? <p role="status" className="mt-3 text-sm text-ink-2">{note}</p> : null}
      </Panel>

      {years.map((y) => {
        const list = byYear(y);
        return (
          <Panel key={y} title={`${y}`} id={`nst-holidays-${y}`}>
            {list.length === 0 ? <p className="mb-3 text-sm text-ink-2">No days off in {y} yet.</p> : null}
            <ul className="divide-y divide-line">
              {list.map((h) =>
                editing?.id === h.id ? (
                  <li key={h.id} className="flex flex-wrap items-end gap-3 py-3">
                    <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                      Day
                      <input type="date" value={editing.day} onChange={(e) => setEditing({ ...editing, day: e.target.value })} className={inputClass} />
                    </label>
                    <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium text-ink-2">
                      Name
                      <input type="text" maxLength={120} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} />
                    </label>
                    <div className="flex items-center gap-2 text-sm text-ink">
                      <Toggle on={editing.recurring} onChange={() => setEditing({ ...editing, recurring: !editing.recurring })} label="Every year" />
                      <span aria-hidden="true">Every year</span>
                    </div>
                    <Button size="sm" onClick={() => update.mutate({ id: h.id, patch: changedOf(h, editing) })} disabled={update.isPending} className="[@media(pointer:coarse)]:!min-h-11">
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(null)} className="[@media(pointer:coarse)]:!min-h-11">
                      Cancel
                    </Button>
                  </li>
                ) : (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">
                        <bdi>{h.name}</bdi>
                      </div>
                      <div className="text-xs text-ink-2">
                        {shortDay(h.day)}
                        {h.recurring ? ' · every year' : ''}
                        {h.expected ? ' · expected date (not announced yet)' : ''}
                        {h.source === 'STARTER' ? ' · public holiday' : ''}
                      </div>
                    </div>
                    {removing === h.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink">Remove {h.name}?</span>
                        <Button size="sm" variant="danger" onClick={() => remove.mutate(h.id)} disabled={remove.isPending} className="[@media(pointer:coarse)]:!min-h-11">
                          Remove
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setRemoving(null)} className="[@media(pointer:coarse)]:!min-h-11">
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {h.expected ? (
                          <Button size="sm" onClick={() => update.mutate({ id: h.id, patch: { expected: false } })} aria-label={`Confirm ${h.name} on ${dayWithYear(h.day)}`} className="[@media(pointer:coarse)]:!min-h-11">
                            Confirm
                          </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" onClick={() => setEditing({ id: h.id, day: h.day, name: h.name, recurring: h.recurring })} aria-label={`Change ${h.name} on ${dayWithYear(h.day)}`} className="[@media(pointer:coarse)]:!min-h-11">
                          Change
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setRemoving(h.id)} aria-label={`Remove ${h.name} on ${dayWithYear(h.day)}`} className="[@media(pointer:coarse)]:!min-h-11">
                          Remove
                        </Button>
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={() => starter.mutate(y)} disabled={starter.isPending} className="[@media(pointer:coarse)]:!min-h-11">
                Add the starter public holidays for {y}
              </Button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
