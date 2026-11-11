import { useEffect, useId, useState } from 'react';
import type { TargetChange, TargetEntry, TargetSource } from '../../api/kpis';
import { formatKpiTarget } from '../../lib/kpi-format';
import { Button } from '../ui/Button';
import { TOUCH_TALL } from '../../lib/touch';

const SOURCE_WORDS: Record<TargetSource, string> = {
  project: 'This project’s',
  company: 'The company’s',
  site: 'The site’s',
  default: 'Built-in',
};
const UNIT_WORDS: Record<TargetEntry['unit'], string> = { percent: '%', days: 'working days', hours: 'working hours', tasks: 'tasks', perWeek: 'a week', items: 'items' };

interface Row {
  target: string;
  band: string;
  /** Back to the level up (only for a target set here). */
  inherit: boolean;
}

const toText = (v: number | null) => (v === null ? '' : String(v));

/**
 * KPI targets as a form: each KPI's target ("at least" / "at most", empty = no target) and its amber band
 * (empty = 10% of the target). `level`: whose targets these are — a company's defaults (administrators) or a
 * project's overrides (whoever runs it); a target set at this level can go back to the level above.
 */
export function TargetsEditor({ metrics, level, busy, error, onSave, onCancel }: { metrics: TargetEntry[]; level: 'company' | 'project'; busy: boolean; error: string | null; onSave: (changes: TargetChange[]) => void; onCancel?: () => void }) {
  const id = useId();
  const initial = () => Object.fromEntries(metrics.map((m) => [m.metric, { target: toText(m.target), band: toText(m.amberBand), inherit: false }])) as Record<string, Row>;
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  // A save's answer (or another company) replaces what is shown.
  useEffect(() => setRows(initial()), [metrics]);

  const set = (metric: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [metric]: { ...r[metric]!, ...patch } }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const changes: TargetChange[] = [];
    for (const m of metrics) {
      const r = rows[m.metric]!;
      if (r.inherit) {
        changes.push({ metric: m.metric, inherit: true });
        continue;
      }
      const target = r.target.trim() === '' ? null : Number(r.target);
      const band = r.band.trim() === '' ? null : Number(r.band);
      if ((target !== null && !Number.isFinite(target)) || (band !== null && (!Number.isFinite(band) || band < 0))) {
        setProblem(`${m.label}: use numbers (or leave it empty).`);
        return;
      }
      if (target === m.target && band === m.amberBand) continue;
      changes.push({ metric: m.metric, target, amberBand: band });
    }
    setProblem(null);
    onSave(changes);
  }

  return (
    <form onSubmit={submit} aria-describedby={`${id}-help`}>
      <p id={`${id}-help`} className="mb-3 text-sm text-ink-2">
        {level === 'company'
          ? 'Every project uses these unless whoever runs it sets its own. Leave a target empty for no target (no light). The amber band is how far off still counts as close (empty: 10% of the target).'
          : 'This project’s own targets replace the company’s. Leave a target empty for no target here; “Use the company’s” goes back to the company default.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
              <th scope="col" className="py-2 pe-3">KPI</th>
              <th scope="col" className="py-2 pe-3">Target</th>
              <th scope="col" className="py-2 pe-3">Amber band</th>
              <th scope="col" className="py-2">Now</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const r = rows[m.metric]!;
              return (
                <tr key={m.metric} className="border-b border-line/70 align-top">
                  <th scope="row" className="py-2 pe-3 text-left font-medium text-ink">
                    {m.label}
                    <span className="block text-xs font-normal text-ink-3">{m.metric === 'progress' ? 'Completion against time used, %' : `${m.direction === 'higher' ? 'At least' : 'At most'}, ${UNIT_WORDS[m.unit]}`}</span>
                  </th>
                  <td className="py-2 pe-3">
                    <input
                      aria-label={`${m.label}: target`}
                      inputMode="decimal"
                      value={r.target}
                      disabled={r.inherit}
                      placeholder="No target"
                      onChange={(e) => set(m.metric, { target: e.target.value })}
                      className={`w-28 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60 ${TOUCH_TALL}`}
                    />
                  </td>
                  <td className="py-2 pe-3">
                    <input
                      aria-label={`${m.label}: amber band`}
                      inputMode="decimal"
                      value={r.band}
                      disabled={r.inherit}
                      placeholder="10%"
                      onChange={(e) => set(m.metric, { band: e.target.value })}
                      className={`w-24 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60 ${TOUCH_TALL}`}
                    />
                  </td>
                  <td className="py-2 text-xs text-ink-2">
                    <span className="block">
                      {SOURCE_WORDS[r.inherit ? 'company' : m.source]}: {formatKpiTarget(m.metric, m.unit, m.direction, m.target)}
                    </span>
                    {m.own ? (
                      <label className={`mt-1 inline-flex items-center gap-1.5 ${TOUCH_TALL}`}>
                        <input type="checkbox" checked={r.inherit} onChange={(e) => set(m.metric, { inherit: e.target.checked })} />
                        {level === 'project' ? 'Use the company’s' : 'Use the built-in default'}
                      </label>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {problem || error ? (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {problem ?? error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} className={TOUCH_TALL}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={busy} className={TOUCH_TALL}>
          Save targets
        </Button>
      </div>
    </form>
  );
}
