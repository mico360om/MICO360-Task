import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { systemSettingsApi } from '../../api/system-settings';
import { DEFAULT_INVITATION_DAYS, INVITATION_DAY_CHOICES, lifetimeText } from '../../lib/onboarding';

export const INVITATION_DAYS_KEY = 'accounts.invitationDays';

/**
 * System Settings → Accounts (1.23.6): how long an invitation link lasts — and an unused temporary
 * password with it. Each invitation can still pick its own lifetime in the form. The change is in the
 * audit log (as every setting).
 */
export function AccountSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list() });
  const stored = Array.isArray(q.data) ? q.data.find((s) => s.key === INVITATION_DAYS_KEY)?.value : undefined;
  const days = typeof stored === 'number' && (INVITATION_DAY_CHOICES as readonly number[]).includes(stored) ? stored : DEFAULT_INVITATION_DAYS;
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: number) => systemSettingsApi(apiClient).set(INVITATION_DAYS_KEY, value),
    onSuccess: () => {
      setProblem(null);
      void qc.invalidateQueries({ queryKey: ['system-settings'] });
    },
    onError: () => setProblem('Couldn’t save the setting. Please try again.'),
  });
  return (
    <section className="card card-pad" aria-labelledby="accounts-admin-heading">
      <h2 id="accounts-admin-heading" className="eyebrow mb-1">Accounts</h2>
      <p className="mb-4 text-sm text-ink-2">
        New people get in with an emailed invitation link, or a temporary password you give them yourself (never by email) that they change at their first sign-in.
      </p>
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      <fieldset className="border-t border-line pt-3" aria-describedby="invitation-days-hint">
        <legend className="mb-2 text-sm font-medium text-ink">Invitation links last</legend>
        <div className="flex flex-wrap gap-2">
          {INVITATION_DAY_CHOICES.map((d) => (
            <label
              key={d}
              className={`relative flex min-h-11 cursor-pointer select-none items-center rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] sm:min-h-0 [@media(pointer:coarse)]:min-h-11 ${
                days === d ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30'
              }`}
            >
              <input type="radio" name="invitation-days" className="sr-only" checked={days === d} disabled={q.isLoading || save.isPending} onChange={() => save.mutate(d)} />
              {lifetimeText(d)}
            </label>
          ))}
        </div>
        <p id="invitation-days-hint" className="mt-2 text-xs text-ink-2">
          An unused temporary password stops working after the same time. Each invitation can choose its own in the form.
        </p>
      </fieldset>
    </section>
  );
}
