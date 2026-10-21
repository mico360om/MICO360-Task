import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { systemSettingsApi } from '../../api/system-settings';
import { ApiError } from '../../lib/api-client';
import { Button } from '../ui/Button';

export interface WorkingHours {
  days: number[];
  start: string;
  end: string;
}

export const DEFAULT_WORKING_HOURS: WorkingHours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const KEY = 'meetings.workingHours';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const isHours = (v: unknown): v is WorkingHours =>
  !!v && typeof v === 'object' && Array.isArray((v as WorkingHours).days) && typeof (v as WorkingHours).start === 'string' && typeof (v as WorkingHours).end === 'string';

/** "Sun–Thu, 08:00–17:00" for the settings list. */
export function workingHoursText(h: WorkingHours): string {
  const days = [...h.days].sort((a, b) => a - b);
  const run = days.length > 1 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  return `${run ? `${DAYS[days[0]!]}–${DAYS[days.at(-1)!]}` : days.map((d) => DAYS[d]).join(', ')}, ${h.start}–${h.end}`;
}

/**
 * System Settings → Meeting hours: the company's working days and times (company time zone). Free-time
 * suggestions in Schedule meeting stay inside them.
 */
export function MeetingHoursSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list() });
  const stored = Array.isArray(q.data) ? q.data.find((s) => s.key === KEY)?.value : undefined;
  const saved = isHours(stored) ? stored : DEFAULT_WORKING_HOURS;
  const [draft, setDraft] = useState<WorkingHours>(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Follow the stored hours when they load or change (compared by value: the object is new each render).
  const savedKey = `${saved.days.join(',')}|${saved.start}|${saved.end}`;
  useEffect(() => setDraft(saved), [savedKey]);

  const save = useMutation({
    mutationFn: (value: WorkingHours) => systemSettingsApi(apiClient).set(KEY, value),
    onSuccess: () => {
      setDone(true);
      void qc.invalidateQueries({ queryKey: ['system-settings'] });
    },
    onError: (e) => setProblem(e instanceof ApiError && e.status === 400 ? 'Those hours can’t be saved. Check the days and times.' : 'Couldn’t save the meeting hours. Please try again.'),
  });

  const toggle = (day: number) => {
    setDone(false);
    setDraft((d) => ({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day].sort((a, b) => a - b) }));
  };
  const submit = () => {
    setProblem(null);
    setDone(false);
    if (draft.days.length === 0) return setProblem('Choose at least one working day.');
    if (!/^\d{2}:\d{2}$/.test(draft.start) || !/^\d{2}:\d{2}$/.test(draft.end)) return setProblem('Choose a start and an end time.');
    if (draft.end <= draft.start) return setProblem('The day has to end after it starts.');
    save.mutate(draft);
  };

  return (
    <section className="card p-5" aria-labelledby="meeting-hours-heading">
      <h2 id="meeting-hours-heading" className="eyebrow mb-1">Meeting hours</h2>
      <p className="mb-4 text-sm text-ink-2">The working days and times (company time) that Schedule meeting suggests free times in.</p>
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      <div role="group" aria-label="Working days" className="mb-4 flex flex-wrap gap-1.5">
        {DAYS.map((name, day) => (
          <button
            key={name}
            type="button"
            aria-pressed={draft.days.includes(day)}
            onClick={() => toggle(day)}
            className={`min-h-9 min-w-[3rem] rounded-lg border px-2.5 text-sm font-semibold transition-colors ${draft.days.includes(day) ? 'border-brand bg-brand text-white' : 'border-line text-ink-2 hover:border-brand/40'}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Day starts
          <input type="time" step={60 * 30} value={draft.start} onChange={(e) => { setDone(false); setDraft((d) => ({ ...d, start: e.target.value })); }} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Day ends
          <input type="time" step={60 * 30} value={draft.end} onChange={(e) => { setDone(false); setDraft((d) => ({ ...d, end: e.target.value })); }} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={save.isPending} aria-label="Save meeting hours">
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {done ? <p role="status" className="text-sm text-ink-2">Saved.</p> : null}
      </div>
    </section>
  );
}
