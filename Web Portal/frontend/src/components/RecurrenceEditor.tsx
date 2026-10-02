import type { RecurrenceRule } from '../api/tasks';
import { upcomingDates, WEEK_OF_MONTH, WEEKDAY_NAMES } from '../lib/recurrence-summary';
import { formatDueDay } from '../lib/due-display';

export interface RecurrenceEditorProps {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** The task's due date ('YYYY-MM-DD' or ISO): previews the next dates and suggests "the 2nd Tuesday". */
  dueDate?: string | null;
}

const FREQS: RecurrenceRule['freq'][] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
const FREQ_LABEL: Record<RecurrenceRule['freq'], string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};
const UNIT: Record<RecurrenceRule['freq'], string> = {
  DAILY: 'day(s)',
  WEEKLY: 'week(s)',
  MONTHLY: 'month(s)',
  QUARTERLY: 'quarter(s)',
  YEARLY: 'year(s)',
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const control = 'rounded-md border border-line bg-surface px-2 py-1 text-ink';

/** A rule without the given keys (undefined keys vanish when the rule is sent as JSON anyway). */
function without(rule: RecurrenceRule, ...keys: (keyof RecurrenceRule)[]): RecurrenceRule {
  const copy = { ...rule };
  for (const k of keys) delete copy[k];
  return copy;
}

/** "The 2nd Tuesday" for a due date: its weekday, and which one of the month it is (5th → last). */
function nthWeekdayOf(dueKey: string): NonNullable<RecurrenceRule['nthWeekday']> {
  const d = new Date(`${dueKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { week: 1, day: 1 };
  const week = Math.ceil(d.getUTCDate() / 7);
  return { week: week >= 5 ? -1 : (week as 1 | 2 | 3 | 4), day: d.getUTCDay() };
}

export function RecurrenceEditor({ value, onChange, dueDate }: RecurrenceEditorProps) {
  const rule = value;
  const dueKey = dueDate ? dueDate.slice(0, 10) : '';

  function setFreq(freq: string) {
    if (freq === 'NONE') { onChange(null); return; }
    // Keep how the series ends and when copies are made; drop the old frequency's day choices.
    const next: RecurrenceRule = { freq: freq as RecurrenceRule['freq'], interval: rule?.interval ?? 1 };
    if (rule?.count != null) next.count = rule.count;
    if (rule?.until != null) next.until = rule.until;
    if (rule?.createNext) next.createNext = rule.createNext;
    if (rule?.paused) next.paused = rule.paused;
    onChange(next);
  }

  function setInterval(n: number) {
    if (!rule) return;
    onChange({ ...rule, interval: Number.isFinite(n) && n >= 1 ? n : 1 });
  }

  function toggleWeekday(day: number) {
    if (!rule) return;
    const current = new Set(rule.weekdays ?? []);
    if (current.has(day)) current.delete(day);
    else current.add(day);
    onChange({ ...rule, weekdays: [...current].sort((a, b) => a - b) });
  }

  function setDayOfMonth(n: number) {
    if (!rule) return;
    onChange({ ...rule, dayOfMonth: Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : undefined });
  }

  const monthlyMode: 'DATE' | 'WEEKDAY' = rule?.nthWeekday ? 'WEEKDAY' : 'DATE';
  function setMonthlyMode(mode: 'DATE' | 'WEEKDAY') {
    if (!rule) return;
    if (mode === 'DATE') onChange(without(rule, 'nthWeekday'));
    else onChange({ ...without(rule, 'dayOfMonth', 'anchorDay'), nthWeekday: rule.nthWeekday ?? nthWeekdayOf(dueKey) });
  }
  function setNth(patch: Partial<NonNullable<RecurrenceRule['nthWeekday']>>) {
    if (!rule?.nthWeekday) return;
    onChange({ ...rule, nthWeekday: { ...rule.nthWeekday, ...patch } });
  }

  function setCreateNext(mode: string) {
    if (!rule) return;
    onChange(mode === 'ON_SCHEDULE' ? { ...rule, createNext: 'ON_SCHEDULE' } : without(rule, 'createNext'));
  }

  const ends: 'NEVER' | 'COUNT' | 'UNTIL' = rule?.count != null ? 'COUNT' : rule?.until != null ? 'UNTIL' : 'NEVER';
  function setEnds(mode: 'NEVER' | 'COUNT' | 'UNTIL') {
    if (!rule) return;
    if (mode === 'NEVER') onChange({ ...rule, count: null, until: null });
    else if (mode === 'COUNT') onChange({ ...rule, count: rule.count ?? 10, until: null });
    else onChange({ ...rule, until: rule.until ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), count: null });
  }
  function setCount(n: number) {
    if (!rule) return;
    onChange({ ...rule, count: Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1, until: null });
  }
  function setUntil(dateStr: string) {
    if (!rule) return;
    onChange({ ...rule, until: dateStr || null, count: null });
  }
  function togglePause() {
    if (!rule) return;
    onChange({ ...rule, paused: !rule.paused });
  }

  const preview = rule && !rule.paused && dueKey ? upcomingDates(dueKey, rule) : [];
  const monthBased = rule?.freq === 'MONTHLY' || rule?.freq === 'QUARTERLY';

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-ink-2">Repeat</span>
        <select aria-label="Repeat" value={rule?.freq ?? 'NONE'} onChange={(e) => setFreq(e.target.value)} className={control}>
          <option value="NONE">Does not repeat</option>
          {FREQS.map((f) => (
            <option key={f} value={f}>{FREQ_LABEL[f]}</option>
          ))}
        </select>
      </label>

      {rule ? (
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Repeat every</span>
          <input
            type="number"
            min={1}
            aria-label="Repeat every"
            value={rule.interval}
            onChange={(e) => setInterval(Number(e.target.value))}
            className={`w-16 ${control}`}
          />
          <span className="text-ink-2">{UNIT[rule.freq]}</span>
        </label>
      ) : null}

      {rule?.freq === 'WEEKLY' ? (
        <div className="flex flex-wrap gap-1">
          {DAY_NAMES.map((name, day) => {
            const on = (rule.weekdays ?? []).includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-label={name}
                aria-pressed={on}
                onClick={() => toggleWeekday(day)}
                className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-brand bg-brand/10 text-brand' : 'border-line text-ink-2'}`}
              >
                {name}
              </button>
            );
          })}
        </div>
      ) : null}

      {rule && monthBased ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">On</span>
          <select
            aria-label={rule.freq === 'MONTHLY' ? 'Monthly on' : 'Quarterly on'}
            value={monthlyMode}
            onChange={(e) => setMonthlyMode(e.target.value as 'DATE' | 'WEEKDAY')}
            className={control}
          >
            <option value="DATE">a day of the month</option>
            <option value="WEEKDAY">a weekday of the month</option>
          </select>
          {monthlyMode === 'DATE' ? (
            <input
              type="number"
              min={1}
              max={31}
              aria-label="Day of month"
              placeholder="due day"
              title="31 means the last day of every month"
              value={rule.dayOfMonth ?? ''}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
              className={`w-20 ${control}`}
            />
          ) : (
            <>
              <span className="text-ink-2">the</span>
              <select aria-label="Week of the month" value={String(rule.nthWeekday?.week ?? 1)} onChange={(e) => setNth({ week: Number(e.target.value) as 1 | 2 | 3 | 4 | -1 })} className={control}>
                {WEEK_OF_MONTH.map((w) => (
                  <option key={w.week} value={String(w.week)}>{w.label}</option>
                ))}
              </select>
              <select aria-label="Weekday" value={String(rule.nthWeekday?.day ?? 1)} onChange={(e) => setNth({ day: Number(e.target.value) })} className={control}>
                {WEEKDAY_NAMES.map((name, day) => (
                  <option key={day} value={String(day)}>{name}</option>
                ))}
              </select>
            </>
          )}
        </div>
      ) : null}

      {rule ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">Ends</span>
          <select aria-label="Ends" value={ends} onChange={(e) => setEnds(e.target.value as 'NEVER' | 'COUNT' | 'UNTIL')} className={control}>
            <option value="NEVER">Never</option>
            <option value="COUNT">After…</option>
            <option value="UNTIL">On date…</option>
          </select>
          {ends === 'COUNT' ? (
            <>
              <input
                type="number"
                min={1}
                aria-label="Number of occurrences"
                value={rule.count ?? 1}
                onChange={(e) => setCount(Number(e.target.value))}
                className={`w-16 ${control}`}
              />
              <span className="text-ink-2">occurrence(s)</span>
            </>
          ) : null}
          {ends === 'UNTIL' ? (
            <input
              type="date"
              aria-label="End date"
              value={rule.until ? rule.until.slice(0, 10) : ''}
              onChange={(e) => setUntil(e.target.value)}
              className={control}
            />
          ) : null}
        </div>
      ) : null}

      {rule ? (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">Create the next copy</span>
          <select aria-label="Create the next copy" value={rule.createNext ?? 'ON_COMPLETE'} onChange={(e) => setCreateNext(e.target.value)} className={control}>
            <option value="ON_COMPLETE">when this one is done</option>
            <option value="ON_SCHEDULE">on each date, even if not done</option>
          </select>
        </label>
      ) : null}

      {preview.length > 0 ? (
        <p className="text-xs text-ink-3">
          Next: {preview.map((d) => formatDueDay(d, 'UTC', { weekday: 'short', month: 'short', day: 'numeric' })).join(' · ')}
        </p>
      ) : null}

      {rule ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePause}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              rule.paused ? 'border-brand bg-brand/10 text-brand' : 'border-line text-ink-2 hover:bg-ground'
            }`}
          >
            {rule.paused ? '▶ Resume series' : '⏸ Pause series'}
          </button>
          {rule.paused ? <span className="text-xs text-ink-3">Paused — no new tasks will be created.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
