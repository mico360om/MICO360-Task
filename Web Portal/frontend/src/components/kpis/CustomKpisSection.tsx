import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { KPI_ROOT, kpisApi, type CustomKpiInput, type CustomKpiView } from '../../api/kpis';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { ApiError } from '../../lib/api-client';
import { formatCustomValue } from '../../lib/kpi-format';
import { TOUCH_TALL } from '../../lib/touch';
import { LightMark } from './kpi-ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!.slice(0, 3);
const field = `w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${TOUCH_TALL}`;
const problemOf = (err: unknown) => (err instanceof ApiError ? err.message : 'Couldn’t save. Please try again.');

function targetWords(k: CustomKpiView): string {
  if (k.target === null) return 'No target';
  return `${k.direction === 'HIGHER' ? 'At least' : 'At most'} ${formatCustomValue(k.target, k.unit)}`;
}

/** Add or change one of the project's own KPIs: its name, unit, which way is better, target and amber band. */
function KpiDialog({ kpi, busy, error, onSave, onClose }: { kpi: CustomKpiView | null; busy: boolean; error: string | null; onSave: (input: CustomKpiInput) => void; onClose: () => void }) {
  const id = useId();
  const ref = useDialog<HTMLFormElement>(busy ? () => {} : onClose);
  const [direction, setDirection] = useState<'HIGHER' | 'LOWER'>(kpi?.direction ?? 'HIGHER');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <ModalPortal>
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <form
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          className={`card relative ${dialogPanel('small')} animate-scale-in overflow-y-auto p-5`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const name = String(f.get('name') ?? '').trim();
            const num = (k: string) => {
              const v = String(f.get(k) ?? '').trim();
              return v === '' ? null : Number(v);
            };
            const target = num('target');
            const amberBand = num('band');
            if (!name) return setProblem('Give it a name.');
            if ((target !== null && !Number.isFinite(target)) || (amberBand !== null && (!Number.isFinite(amberBand) || amberBand < 0))) return setProblem('Target and amber band are numbers (or empty).');
            setProblem(null);
            onSave({ name, unit: String(f.get('unit') ?? '').trim(), direction, target, amberBand });
          }}
        >
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-ink">
            {kpi ? 'Change this KPI' : 'Add a KPI'}
          </h2>
          <p className="mt-1 text-sm text-ink-2">Entered once a month by whoever runs the project, e.g. “Safety incidents” or “Budget used”.</p>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm font-medium text-ink">
              Name
              <input name="name" required maxLength={80} defaultValue={kpi?.name ?? ''} className={field} autoComplete="off" />
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">
              Unit <span className="text-xs font-normal text-ink-2">Shown after the value: %, incidents, OMR… (optional)</span>
              <input name="unit" maxLength={24} defaultValue={kpi?.unit ?? ''} className={field} autoComplete="off" />
            </label>
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium text-ink">Better when it is</legend>
              <div className="flex gap-4 text-sm">
                {(['HIGHER', 'LOWER'] as const).map((d) => (
                  <label key={d} className={`inline-flex items-center gap-2 ${TOUCH_TALL}`}>
                    <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} />
                    {d === 'HIGHER' ? 'Higher' : 'Lower'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm font-medium text-ink">
                Target
                <input name="target" inputMode="decimal" defaultValue={kpi?.target ?? ''} placeholder="No target" className={field} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-ink">
                Amber band
                <input name="band" inputMode="decimal" defaultValue={kpi?.amberBand ?? ''} placeholder="10% of the target" className={field} />
              </label>
            </div>
          </div>
          {problem || error ? (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {problem ?? error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className={TOUCH_TALL}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} className={TOUCH_TALL}>
              {kpi ? 'Save' : 'Add KPI'}
            </Button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

/** Enter (or change, or clear) one month's value with an optional note. */
function ValueDialog({ kpi, months, busy, error, onSave, onClear, onClose }: { kpi: CustomKpiView; months: string[]; busy: boolean; error: string | null; onSave: (month: string, value: number, note: string | null) => void; onClear: (month: string) => void; onClose: () => void }) {
  const id = useId();
  const ref = useDialog<HTMLFormElement>(busy ? () => {} : onClose);
  const first = kpi.due && months.includes(kpi.due) ? kpi.due : months.at(-1)!;
  const [month, setMonth] = useState(first);
  const current = kpi.values.find((v) => v.month === month);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <ModalPortal>
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <form
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          className={`card relative ${dialogPanel('small')} animate-scale-in overflow-y-auto p-5`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const raw = String(f.get('value') ?? '').trim();
            const value = Number(raw);
            if (raw === '' || !Number.isFinite(value)) return setProblem('Enter a number.');
            setProblem(null);
            const note = String(f.get('note') ?? '').trim();
            onSave(month, value, note || null);
          }}
        >
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-ink">
            <bdi>{kpi.name}</bdi>
          </h2>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm font-medium text-ink">
              Month
              <select value={month} onChange={(e) => setMonth(e.target.value)} className={field}>
                {[...months].reverse().map((m) => (
                  <option key={m} value={m}>
                    {monthWords(m)}
                    {kpi.values.find((v) => v.month === m)?.value !== null && kpi.values.find((v) => v.month === m)?.value !== undefined ? ' (entered)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">
              Value{kpi.unit ? ` (${kpi.unit})` : ''}
              <input key={month} name="value" inputMode="decimal" defaultValue={current?.value ?? ''} className={field} autoFocus />
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">
              Note <span className="text-xs font-normal text-ink-2">(optional)</span>
              <textarea key={`${month}-note`} name="note" maxLength={500} rows={2} defaultValue={current?.note ?? ''} className={field} />
            </label>
          </div>
          {problem || error ? (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {problem ?? error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {current && current.value !== null ? (
              <Button type="button" variant="ghost" onClick={() => onClear(month)} disabled={busy} className={`me-auto ${TOUCH_TALL}`}>
                Clear {monthShort(month)}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className={TOUCH_TALL}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} className={TOUCH_TALL}>
              Save value
            </Button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

/**
 * The project's own KPIs (owner 1): name, unit, target, the last six months' values with the latest one's
 * light. Whoever runs the project (and administrators) add, change and remove them and enter each month's
 * value; everyone who may see the project reads them.
 */
export function CustomKpisSection({ projectId, custom, canManage }: { projectId: string; custom: CustomKpiView[]; canManage: boolean }) {
  const qc = useQueryClient();
  const api = kpisApi(apiClient);
  const [editing, setEditing] = useState<CustomKpiView | 'new' | null>(null);
  const [entering, setEntering] = useState<CustomKpiView | null>(null);
  const [removing, setRemoving] = useState<CustomKpiView | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: [...KPI_ROOT, 'project', projectId] });
  const save = useMutation({
    mutationFn: (input: CustomKpiInput) => (editing && editing !== 'new' ? api.editCustom(projectId, editing.id, input) : api.addCustom(projectId, input)),
    onSuccess: () => {
      setEditing(null);
      done();
    },
  });
  const value = useMutation({
    mutationFn: (v: { month: string; value: number | null; note: string | null }) => (v.value === null ? api.clearValue(projectId, entering!.id, v.month) : api.setValue(projectId, entering!.id, v.month, v.value, v.note)),
    onSuccess: () => {
      setEntering(null);
      done();
    },
  });
  const remove = useMutation({
    mutationFn: (k: CustomKpiView) => api.removeCustom(projectId, k.id),
    onSuccess: () => {
      setRemoving(null);
      done();
    },
  });
  const months = custom[0]?.values.map((v) => v.month) ?? [];

  return (
    <section className="card card-pad" aria-labelledby={`custom-kpis-${projectId}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`custom-kpis-${projectId}`} className="eyebrow">
            The project’s own KPIs
          </h2>
          <p className="text-sm text-ink-2">Entered each month{canManage ? ' — you’re reminded on the first working day of the month.' : ' by whoever runs the project.'}</p>
        </div>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={() => { save.reset(); setEditing('new'); }} className={TOUCH_TALL}>
            Add a KPI
          </Button>
        ) : null}
      </div>
      {custom.length === 0 ? (
        <p className="text-sm text-ink-2">{canManage ? 'None yet. Add one to track something tasks don’t show, like safety incidents or budget used.' : 'None yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">The project’s own KPIs by month</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
                <th scope="col" className="py-2 pe-3">KPI</th>
                <th scope="col" className="py-2 pe-3">Latest</th>
                {months.map((m) => (
                  <th key={m} scope="col" className="py-2 pe-3 text-right">
                    {monthShort(m)}
                  </th>
                ))}
                {canManage ? <th scope="col" className="py-2"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {custom.map((k) => (
                <tr key={k.id} className="border-b border-line/70 align-top">
                  <th scope="row" className="py-2 pe-3 text-left font-medium text-ink">
                    <bdi>{k.name}</bdi>
                    <span className="block text-xs font-normal text-ink-2">{targetWords(k)}</span>
                    {k.due && canManage ? <span className="block text-xs font-normal text-ink-2">{monthWords(k.due)} not entered yet</span> : null}
                  </th>
                  <td className="py-2 pe-3">
                    <span className="block font-semibold tabular-nums text-ink">{k.latest ? formatCustomValue(k.latest.value, k.unit) : '—'}</span>
                    {k.latest ? <span className="block text-xs text-ink-2">{monthWords(k.latest.month)}</span> : null}
                    <LightMark light={k.light} words={k.words} className="mt-1" />
                  </td>
                  {k.values.map((v) => (
                    <td key={v.month} className="py-2 pe-3 text-right tabular-nums text-ink" title={v.note ?? undefined}>
                      {v.value === null ? <span className="text-ink-3">—</span> : formatCustomValue(v.value, k.unit === '%' ? '%' : '')}
                      {v.note ? <span className="sr-only">. Note: {v.note}</span> : null}
                    </td>
                  ))}
                  {canManage ? (
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => { value.reset(); setEntering(k); }} className={TOUCH_TALL} aria-label={`Enter a value for ${k.name}`}>
                          Enter value
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { save.reset(); setEditing(k); }} className={TOUCH_TALL} aria-label={`Change ${k.name}`}>
                          Change
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { remove.reset(); setRemoving(k); }} className={TOUCH_TALL} aria-label={`Remove ${k.name}`}>
                          Remove
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <KpiDialog kpi={editing === 'new' ? null : editing} busy={save.isPending} error={save.error ? problemOf(save.error) : null} onSave={(i) => save.mutate(i)} onClose={() => setEditing(null)} /> : null}
      {entering ? (
        <ValueDialog
          kpi={entering}
          months={months}
          busy={value.isPending}
          error={value.error ? problemOf(value.error) : null}
          onSave={(month, v, note) => value.mutate({ month, value: v, note })}
          onClear={(month) => value.mutate({ month, value: null, note: null })}
          onClose={() => setEntering(null)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog title={`Remove “${removing.name}”?`} confirmLabel="Remove" busy={remove.isPending} error={remove.error ? problemOf(remove.error) : undefined} onConfirm={() => remove.mutate(removing)} onClose={() => setRemoving(null)}>
          Its monthly values go with it. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
