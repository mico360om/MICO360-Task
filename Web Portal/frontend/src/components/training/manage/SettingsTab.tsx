import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrainingSettings } from '../../../api/training';
import { LoadError } from '../../ui/LoadError';
import { Toggle } from '../../ui/Toggle';
import { Notice, SectionCard, problemText } from './manage-ui';
import { manageKeys, tc } from './manage-queries';

/**
 * Training Center settings (administrators; owner 17): the first-time tour, on or off per company. New
 * accounts whose primary company has it off don't see it on their own (anyone can still replay it from Help).
 */
export function SettingsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: manageKeys.settings, queryFn: () => tc().settings() });
  const save = useMutation({
    mutationFn: (tourOff: string[]) => tc().saveSettings({ tourOff }),
    onSuccess: (next) => qc.setQueryData<TrainingSettings>(manageKeys.settings, next),
  });
  const s = q.data;
  const pendingOff = save.isPending ? save.variables : null;
  const offNow = pendingOff ?? s?.tourOff ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SectionCard
        id="tc-settings-tour"
        title="First-time tour"
        description="New accounts see a short tour of the site the first time they sign in (staff: six steps; clients: three in the Client portal). They can skip it, and replay it from Help any time. Switch it off for a company whose people don’t need it."
      >
        {save.isError ? <div className="mb-3"><Notice>{`Couldn’t save that change. ${problemText(save.error)}`}</Notice></div> : null}
        {q.isError ? (
          <LoadError what="the settings" onRetry={() => void q.refetch()} />
        ) : !s ? (
          <div className="skeleton h-24 rounded-xl" role="status" aria-label="Loading the settings" />
        ) : s.companies.length === 0 ? (
          <p className="text-sm text-ink-2">No companies yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {s.companies.map((c) => {
              const on = !offNow.includes(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between gap-4 px-3 py-2.5">
                  <div className="min-w-0">
                    <span dir="auto" className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{c.name}</span>
                    <span className="block text-xs text-ink-2">{on ? 'Tour shown to new accounts' : 'Tour off'}</span>
                  </div>
                  <Toggle
                    on={on}
                    label={`First-time tour: ${c.name}`}
                    disabled={save.isPending}
                    onChange={() => {
                      save.reset();
                      const current = s.tourOff;
                      save.mutate(current.includes(c.id) ? current.filter((x) => x !== c.id) : [...current, c.id]);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
