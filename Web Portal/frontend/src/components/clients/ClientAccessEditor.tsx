import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { CLIENT_PROJECT_OPTIONS_KEY, clientsApi } from '../../api/clients';
import type { ApiProject } from '../../api/projects';
import { ProjectAvatar } from '../ProjectAvatar';
import { Badge } from '../ui/Badge';
import { LoadError } from '../ui/LoadError';
import { SearchableSelect, type SelectOption } from '../ui/SearchableSelect';
import { ACTIONS, MODULES, NO_MODULE_ROW, actionOpen, hasModule, newRow, withAction, withModule, type AccessRow } from './client-access';

export interface ClientAccessEditorProps {
  /** The projects on the account, each with its ticks. */
  value: AccessRow[];
  onChange: (rows: AccessRow[]) => void;
  /** Makes the ids of its fields unique on the page. */
  idPrefix: string;
  /** After a save attempt: a project with no module is marked on its module ticks. */
  showErrors?: boolean;
  /** 'section': a heading like the other sections of Manage account; 'field' (default): a form field's label. */
  variant?: 'field' | 'section';
}

/** A finger-sized row on a touch screen (the box stays 16px). */
const TICK_ROW = 'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:items-center';
const SUBHEAD = 'text-xs font-semibold text-ink-2';

/**
 * A client's project access (1.23) — the one editor for New user with Role "Client", Manage account
 * on a client and the Clients page. Pick projects (searchable, from the live, non-archived ones); per
 * project two modules and four actions, all off until ticked. An action whose module is off is greyed
 * out with a short hint, and unticked: the server would save it off anyway. Each project needs a module.
 */
export function ClientAccessEditor({ value, onChange, idPrefix, showErrors = false, variant = 'field' }: ClientAccessEditorProps) {
  const qc = useQueryClient();
  const optionsQ = useQuery({ queryKey: CLIENT_PROJECT_OPTIONS_KEY, queryFn: () => clientsApi(apiClient).projectOptions() });
  const options = Array.isArray(optionsQ.data) ? optionsQ.data : [];
  // The projects' pictures, when the site has already listed them (the options carry names only).
  const looks = new Map((qc.getQueryData<ApiProject[]>(['projects']) ?? []).map((p) => [p.id, p]));
  const lookOf = (id: string, name: string) => {
    const p = looks.get(id);
    return { name, color: p?.color, icon: p?.icon, imageUrl: p?.imageUrl };
  };

  const added = new Set(value.map((r) => r.projectId));
  const offered: SelectOption[] = options
    .filter((o) => !added.has(o.id))
    .map((o) => ({ value: o.id, label: o.name, hint: o.company ? `${o.code} · ${o.company}` : o.code, icon: <ProjectAvatar project={lookOf(o.id, o.name)} size="xs" /> }));

  const replace = (projectId: string, next: AccessRow) => onChange(value.map((r) => (r.projectId === projectId ? next : r)));
  const add = (id: string) => {
    const o = options.find((x) => x.id === id);
    if (o && !added.has(id)) onChange([...value, newRow(o)]);
  };
  const remove = (projectId: string) => onChange(value.filter((r) => r.projectId !== projectId));

  const titleClass = variant === 'section' ? 'mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2' : 'text-sm font-medium text-ink';
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={`${idPrefix}-about`}>
      <legend className={titleClass}>Project access</legend>
      <p id={`${idPrefix}-about`} className="-mt-1 text-xs text-ink-2">
        The projects they may open in the Client portal, and what they may see and do in each. Everything is off until you tick it.
      </p>

      {optionsQ.isError ? (
        <LoadError what="the projects" onRetry={() => void optionsQ.refetch()} />
      ) : optionsQ.isSuccess && options.length === 0 && value.length === 0 ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">There are no projects to give yet.</p>
      ) : (
        <SearchableSelect
          id={`${idPrefix}-add`}
          ariaLabel="Add a project"
          placeholder={optionsQ.isLoading ? 'Loading projects…' : 'Add a project…'}
          disabled={optionsQ.isLoading}
          options={offered}
          value=""
          onChange={add}
          emptyText={options.length > 0 && offered.length === 0 ? 'Every project is on the list' : 'No matches'}
          size="lg"
        />
      )}

      {value.length === 0 ? (
        <p className="text-xs text-ink-2">No projects yet: until you add one, their Client portal is empty.</p>
      ) : (
        <ul aria-label="Their projects" className="flex flex-col gap-3">
          {value.map((row) => {
            const id = `${idPrefix}-${row.projectId}`;
            const missing = !hasModule(row);
            const flagged = missing && showErrors;
            return (
              <li key={row.projectId}>
                <fieldset aria-labelledby={`${id}-name`} className={`min-w-0 rounded-xl border p-3 ${flagged ? 'border-danger/60' : 'border-line'} bg-surface`}>
                  <div className="flex items-start gap-2.5">
                    <ProjectAvatar project={lookOf(row.projectId, row.name)} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <bdi id={`${id}-name`} className="font-semibold text-ink [overflow-wrap:anywhere]">{row.name}</bdi>
                        {row.archived ? <Badge>Archived</Badge> : null}
                      </p>
                      <p className="text-xs text-ink-2 [overflow-wrap:anywhere]">
                        <span className="font-mono">{row.code}</span>
                        {row.company ? <> · <bdi>{row.company}</bdi></> : null}
                      </p>
                      {row.archived ? <p className="mt-0.5 text-xs text-ink-2">Archived: hidden in the Client portal until it’s unarchived.</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(row.projectId)}
                      aria-label={`Remove ${row.name}`}
                      title="Take this project off their access"
                      className="flex-none rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger [@media(pointer:coarse)]:!min-h-11"
                    >
                      Remove
                    </button>
                  </div>

                  <div role="group" aria-labelledby={`${id}-modules`} className="mt-3">
                    <p id={`${id}-modules`} className={SUBHEAD}>What they see</p>
                    <div className="mt-1 grid gap-x-3 sm:grid-cols-2">
                      {MODULES.map((m) => (
                        <label key={m.key} className={`${TICK_ROW} text-ink hover:bg-ground`}>
                          <input
                            type="checkbox"
                            checked={row.modules[m.key]}
                            onChange={(e) => replace(row.projectId, withModule(row, m.key, e.target.checked))}
                            aria-invalid={flagged ? true : undefined}
                            aria-describedby={missing ? `${id}-missing` : undefined}
                            className="mt-0.5 h-4 w-4 flex-none accent-brand [@media(pointer:coarse)]:mt-0"
                          />
                          <span className="min-w-0">{m.label}</span>
                        </label>
                      ))}
                    </div>
                    {missing ? (
                      <p id={`${id}-missing`} className={`mt-1 rounded-lg px-2 py-1 text-xs ${flagged ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
                        {NO_MODULE_ROW}
                      </p>
                    ) : null}
                  </div>

                  <div role="group" aria-labelledby={`${id}-actions`} className="mt-3">
                    <p id={`${id}-actions`} className={SUBHEAD}>What they may do</p>
                    <div className="mt-1 grid gap-x-3 sm:grid-cols-2">
                      {ACTIONS.map((a) => {
                        const open = actionOpen(row.modules, a.key);
                        const hintId = `${id}-${a.key}-hint`;
                        return (
                          <div key={a.key} className="flex min-w-0 flex-col">
                            <label className={`${TICK_ROW} ${open ? 'text-ink hover:bg-ground' : 'cursor-not-allowed text-ink-3'}`}>
                              <input
                                type="checkbox"
                                checked={open && row.actions[a.key]}
                                disabled={!open}
                                onChange={(e) => replace(row.projectId, withAction(row, a.key, e.target.checked))}
                                aria-describedby={open ? undefined : hintId}
                                className="mt-0.5 h-4 w-4 flex-none accent-brand disabled:opacity-50 [@media(pointer:coarse)]:mt-0"
                              />
                              <span className="min-w-0">{a.label}</span>
                            </label>
                            {open ? null : (
                              <span id={hintId} className="-mt-1 ps-[2.125rem] text-[11px] text-ink-3">{a.hint}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
