import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrainingSettings } from '../../../api/training';
import { LoadError } from '../../ui/LoadError';
import { Toggle } from '../../ui/Toggle';
import { Notice, problemText } from './manage-ui';
import { manageKeys, tc } from './manage-queries';

/**
 * System Settings → Learning Hub (administrators; owner 17, moved here from Manage on 12 Nov — R8): the first-time
 * tour, on or off per company. New accounts whose primary company has it off don't see it on their own; anyone can
 * still see it again from "Tour of the site".
 */
export function TourSettingsCard() {
  const headingId = useId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: manageKeys.settings, queryFn: () => tc().settings() });
  const save = useMutation({
    mutationFn: (tourOff: string[]) => tc().saveSettings({ tourOff }),
    onSuccess: (next) => qc.setQueryData<TrainingSettings>(manageKeys.settings, next),
  });
  const s = q.data;
  const companies = Array.isArray(s?.companies) ? s.companies : [];
  const savedOff = Array.isArray(s?.tourOff) ? s.tourOff : [];
  const offNow = (save.isPending ? save.variables : null) ?? savedOff;

  return (
    <section aria-labelledby={headingId} className="card card-pad min-w-0">
      <h2 id={headingId} className="eyebrow mb-1">
        Learning Hub
      </h2>
      <p className="mb-3 text-sm text-ink-2">
        New accounts see a short tour of the site the first time they sign in (staff: six steps; clients: three). They can skip it and see it again from “Tour of the site” (staff: in the account menu). Switch it off for a company whose people don’t need it.
      </p>
      {save.isError ? (
        <div className="mb-3">
          <Notice>{`Couldn’t save that change. ${problemText(save.error)}`}</Notice>
        </div>
      ) : null}
      {q.isError ? (
        <LoadError what="the tour setting" onRetry={() => void q.refetch()} />
      ) : !s ? (
        <div className="skeleton h-24 rounded-xl" role="status" aria-label="Loading the tour setting" />
      ) : companies.length === 0 ? (
        <p className="text-sm text-ink-2">No companies yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {companies.map((c) => {
            const on = !offNow.includes(c.id);
            return (
              <li key={c.id} className="flex items-center justify-between gap-4 px-3 py-2.5">
                <div className="min-w-0">
                  <span dir="auto" className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">
                    {c.name}
                  </span>
                  <span className="block text-xs text-ink-2">{on ? 'Tour shown to new accounts' : 'Tour off'}</span>
                </div>
                <Toggle
                  on={on}
                  label={`First-time tour: ${c.name}`}
                  disabled={save.isPending}
                  onChange={() => {
                    save.reset();
                    save.mutate(savedOff.includes(c.id) ? savedOff.filter((x) => x !== c.id) : [...savedOff, c.id]);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
