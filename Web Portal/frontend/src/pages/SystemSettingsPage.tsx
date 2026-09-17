import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { apiClient } from '../api/client';
import { systemSettingsApi } from '../api/system-settings';
import { tasksApi } from '../api/tasks';

const CARRY_STATUSES: { value: string; label: string }[] = [
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'REVIEW', label: 'Review' },
];
const DEFAULT_STATUSES = CARRY_STATUSES.map((s) => s.value);

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export function SystemSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list() });
  const settings = q.data ?? [];
  const byKey = new Map(settings.map((s) => [s.key, s.value] as const));

  const enabled = byKey.has('carryForward.enabled') ? Boolean(byKey.get('carryForward.enabled')) : true;
  const statuses = Array.isArray(byKey.get('carryForward.statuses')) ? (byKey.get('carryForward.statuses') as string[]) : DEFAULT_STATUSES;

  const [ranMsg, setRanMsg] = useState<string | null>(null);

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => systemSettingsApi(apiClient).set(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-settings'] }),
  });
  const runMut = useMutation({
    mutationFn: () => tasksApi(apiClient).runCarryForward(),
    onSuccess: (res) => {
      setRanMsg(`Carried ${res.carried} task${res.carried === 1 ? '' : 's'} forward.`);
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    onError: () => setRanMsg('Couldn’t run carry-forward.'),
  });

  function toggleStatus(value: string) {
    const next = statuses.includes(value) ? statuses.filter((s) => s !== value) : [...statuses, value];
    setMut.mutate({ key: 'carryForward.statuses', value: next });
  }

  return (
    <div>
      <PageHeader eyebrow="Admin" title="System Settings" subtitle="Company-wide configuration." />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Carry-forward */}
        <section className="card p-5">
          <h2 className="eyebrow mb-1">Task carry-forward</h2>
          <p className="mb-4 text-sm text-ink-2">
            At the start of each day, still-open tasks left on past days move onto today’s board. Completed tasks stay on their day.
          </p>

          <div className="flex items-center justify-between border-t border-line py-3">
            <div>
              <div className="text-sm font-medium text-ink">Automatic carry-forward</div>
              <div className="text-xs text-ink-2">Runs nightly in the company time zone.</div>
            </div>
            <Toggle on={enabled} onChange={() => setMut.mutate({ key: 'carryForward.enabled', value: !enabled })} label="Automatic carry-forward" />
          </div>

          <div className="border-t border-line py-3">
            <div className="mb-2 text-sm font-medium text-ink">Statuses that carry forward</div>
            <div className="flex flex-wrap gap-2">
              {CARRY_STATUSES.map((s) => {
                const on = statuses.includes(s.value);
                return (
                  <label
                    key={s.value}
                    className={`flex cursor-pointer select-none items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      on ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30'
                    } ${enabled ? '' : 'pointer-events-none opacity-50'}`}
                  >
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleStatus(s.value)} disabled={!enabled} />
                    {s.label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-line pt-3">
            <Button size="sm" variant="secondary" loading={runMut.isPending} onClick={() => runMut.mutate()}>
              Run carry-forward now
            </Button>
            {ranMsg ? <span className="text-sm text-ink-2">{ranMsg}</span> : null}
          </div>
        </section>

        {/* Raw settings */}
        <section className="card p-5">
          <h2 className="eyebrow mb-3">All settings</h2>
          {q.isLoading ? (
            <p className="text-ink-2">Loading…</p>
          ) : q.isError ? (
            <p role="alert" className="text-danger">Couldn’t load settings (admin only).</p>
          ) : settings.length === 0 ? (
            <p className="text-ink-2">No settings configured yet.</p>
          ) : (
            <dl className="divide-y divide-line">
              {settings.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4 py-3">
                  <dt className="font-mono text-xs text-ink-2">{s.key}</dt>
                  <dd className="truncate text-sm font-medium text-ink">{typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
