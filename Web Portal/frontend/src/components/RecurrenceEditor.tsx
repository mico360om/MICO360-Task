import type { RecurrenceRule } from '../api/tasks';

export interface RecurrenceEditorProps {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
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

export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps) {
  const rule = value;

  function setFreq(freq: string) {
    if (freq === 'NONE') { onChange(null); return; }
    onChange({ freq: freq as RecurrenceRule['freq'], interval: rule?.interval ?? 1 });
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

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-ink-2">Repeat</span>
        <select
          aria-label="Repeat"
          value={rule?.freq ?? 'NONE'}
          onChange={(e) => setFreq(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-ink"
        >
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
            className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-ink"
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

      {rule?.freq === 'MONTHLY' || rule?.freq === 'QUARTERLY' ? (
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Day of month</span>
          <input
            type="number"
            min={1}
            max={31}
            aria-label="Day of month"
            value={rule.dayOfMonth ?? ''}
            onChange={(e) => setDayOfMonth(Number(e.target.value))}
            className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-ink"
          />
        </label>
      ) : null}

      {rule ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">Ends</span>
          <select
            aria-label="Ends"
            value={ends}
            onChange={(e) => setEnds(e.target.value as 'NEVER' | 'COUNT' | 'UNTIL')}
            className="rounded-md border border-line bg-surface px-2 py-1 text-ink"
          >
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
                className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-ink"
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
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink"
            />
          ) : null}
        </div>
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
