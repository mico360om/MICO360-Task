import { useId, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { PROJECT_TEMPLATES_KEY, templatesApi, type TemplatePlan } from '../../api/templates';
import type { DirectoryUser } from '../../api/users';
import { isWholeDate } from '../../lib/date-box';
import { dayLabel } from '../../lib/day-label';
import { SearchableSelect } from '../ui/SearchableSelect';
import { PriorityBadge } from '../ui/PriorityBadge';
import { Avatar } from '../ui/Avatar';
import { activePeople, personName } from '../project-form/owner-options';
import { count, TemplateGlyph } from './TemplateCard';

/** A new project's template, its start day and who fills each of its roles (role id → person id). */
export interface TemplateChoice {
  id: string;
  startDate: string;
  roles: Record<string, string>;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const listWords = (words: string[], joiner = 'and') => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]}`);

/** "Sun 8 Nov" (the year too when it isn't this one). */
const dueLabel = (key: string, today: string) => dayLabel(key, { year: key.slice(0, 4) !== today.slice(0, 4) });

/** The plan for the chosen template and start day (shared by the section and the form's submit). */
export function useTemplatePlan(choice: TemplateChoice | null) {
  return useQuery({
    queryKey: ['templates', 'plan', choice?.id, choice?.startDate],
    queryFn: () => templatesApi(apiClient).plan(choice!.id, choice!.startDate),
    enabled: !!choice && isWholeDate(choice.startDate),
    placeholderData: keepPreviousData,
  });
}

/**
 * The New project form's "Start from a template": a template (or a blank project), the day the
 * project starts (today unless changed), who fills each of its roles (active people; they join the
 * team), and the tasks it will create — each with its due day and who will do it — so nothing is a
 * surprise. A role left empty leaves its tasks to the project's owner, as any new task.
 */
export function TemplateStart({
  choice,
  onChange,
  today,
  directory,
  ownerId,
  plan,
  planError,
  onRetry,
}: {
  choice: TemplateChoice | null;
  onChange: (choice: TemplateChoice | null) => void;
  today: string;
  directory: DirectoryUser[];
  /** Who owns the new project (gets the tasks of roles nobody fills). */
  ownerId: string;
  plan: TemplatePlan | undefined;
  planError: boolean;
  onRetry: () => void;
}) {
  const ids = { heading: useId(), start: useId(), startNote: useId(), roles: useId() };
  const listQ = useQuery({ queryKey: PROJECT_TEMPLATES_KEY, queryFn: () => templatesApi(apiClient).listProjects() });
  const templates = Array.isArray(listQ.data) ? listQ.data.filter((t) => t && typeof t.name === 'string' && typeof t.taskCount === 'number') : [];
  const options = [
    { value: '', label: 'Blank project', hint: 'the usual board, no tasks' },
    ...templates.map((t) => ({ value: t.id, label: t.name, hint: count(t.taskCount, 'task') })),
    // The one asked for (e.g. from the Templates page) while the list loads.
    ...(choice && !templates.some((t) => t.id === choice.id) && plan?.template?.id === choice.id ? [{ value: choice.id, label: plan.template.name }] : []),
  ];
  const people = useMemo(() => activePeople(directory), [directory]);
  const personOptions = useMemo(
    () => [
      { value: '', label: 'Nobody — the owner gets these tasks' },
      ...people.map((u) => ({ value: u.id, label: personName(u), hint: `@${u.username}`, icon: <Avatar name={personName(u)} size="sm" src={u.avatarUrl} /> })),
    ],
    [people],
  );
  const nameOf = (id: string | undefined) => {
    const u = id ? directory.find((d) => d.id === id) : undefined;
    return u ? personName(u) : null;
  };
  const current = plan && choice && plan.template?.id === choice.id ? plan : undefined;
  const roles = current?.template.roles ?? [];
  const daysOff = current ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !current.workingDays.includes(d)).map((d) => DAY_NAMES[d]!) : [];
  const ownerName = nameOf(ownerId);

  const choose = (id: string) => onChange(id ? { id, startDate: choice?.startDate || today, roles: {} } : null);

  return (
    <section aria-labelledby={ids.heading} className="rounded-2xl border border-line bg-ground/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-brand">{TemplateGlyph.project}</span>
        <h3 id={ids.heading} className="text-sm font-semibold text-ink">
          Start from a template <span className="text-xs font-normal text-ink-2">(optional)</span>
        </h3>
      </div>
      <SearchableSelect size="lg" ariaLabel="Template" options={options} value={choice?.id ?? ''} onChange={choose} placeholder={listQ.isLoading ? 'Loading…' : 'Blank project'} />

      {choice ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
            <div>
              <label htmlFor={ids.start} className="mb-1.5 block text-sm font-semibold text-ink">Start date</label>
              <input
                id={ids.start}
                type="date"
                value={choice.startDate}
                onChange={(e) => onChange({ ...choice, startDate: e.target.value })}
                aria-describedby={ids.startNote}
                className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <p id={ids.startNote} className="text-xs text-ink-2 sm:pt-8">
              Due dates count from this day.{' '}
              {daysOff.length ? `A due day on a ${listWords(daysOff, 'or')} (${daysOff.length === 1 ? 'a day off' : 'days off'}) moves to the next working day.` : ''}
            </p>
          </div>

          {roles.length ? (
            <fieldset aria-describedby={ids.roles}>
              <legend className="mb-1.5 text-sm font-semibold text-ink">Who fills each role</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {roles.map((r) => (
                  <div key={r.id} className="min-w-0">
                    <span className="mb-1 block text-xs font-semibold text-ink-2">{r.name}</span>
                    <SearchableSelect
                      ariaLabel={`Person for ${r.name}`}
                      options={personOptions}
                      value={choice.roles[r.id] ?? ''}
                      onChange={(v) => {
                        const next = { ...choice.roles };
                        if (v) next[r.id] = v;
                        else delete next[r.id];
                        onChange({ ...choice, roles: next });
                      }}
                    />
                  </div>
                ))}
              </div>
              <p id={ids.roles} className="mt-1.5 text-xs text-ink-2">The people you pick join the project’s team. One person can fill several roles.</p>
            </fieldset>
          ) : null}

          {planError ? (
            <p role="alert" className="text-sm text-danger">Couldn’t load the template’s tasks. <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button></p>
          ) : !current ? (
            <div className="skeleton h-32 rounded-xl" aria-label="Loading the template’s tasks" />
          ) : (
            <div>
              <p className="text-sm text-ink">
                Creates {count(current.tasks.length, 'task')} on a board of {count(current.template.columns.length, 'column')}:{' '}
                <span className="text-ink-2">{current.template.columns.map((c) => c.name).join(' · ')}</span>
                {current.tasks.length ? <span className="text-ink-2">. The tasks start in {current.template.columns[current.startColumn]?.name ?? 'the first column'}.</span> : null}
              </p>
              {current.overdue ? (
                <p role="status" className="mt-2 rounded-xl bg-warning-soft px-3 py-2 text-xs font-medium text-warning">
                  {current.overdue === 1 ? '1 task will be overdue as soon as the project is created' : `${current.overdue} tasks will be overdue as soon as the project is created`}, because the start date is in the past.
                </p>
              ) : null}
              {current.tasks.length ? (
                <ol aria-label="Tasks it will create" tabIndex={0} className="mt-2 max-h-72 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface">
                  {current.tasks.map((t) => {
                    const role = t.roleId ? roles.find((r) => r.id === t.roleId) : undefined;
                    const filler = role ? nameOf(choice.roles[role.id]) : null;
                    return (
                      <li key={t.position} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-sm last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_44px]">
                        <span className="w-6 flex-none text-end text-xs tabular-nums text-ink-3">{t.position + 1}</span>
                        <span dir="auto" className="min-w-0 flex-[1_1_10rem] truncate font-medium text-ink">{t.title}</span>
                        {t.priority !== 'NORMAL' ? <PriorityBadge priority={t.priority} /> : null}
                        <span className="flex-none text-xs text-ink-2">
                          {t.dueDate ? (
                            <>
                              Due <time dateTime={t.dueDate} className={t.dueDate < current.today ? 'font-semibold text-danger' : ''}>{dueLabel(t.dueDate, current.today)}</time>
                              {t.movedFrom ? <span className="text-ink-3"> (moved from {dayLabel(t.movedFrom, { only: 'weekday' })})</span> : null}
                            </>
                          ) : (
                            'No due date'
                          )}
                        </span>
                        <span className="flex-none text-xs text-ink-2">
                          <span className="sr-only">Done by </span>
                          {filler ? (
                            <bdi className="font-medium text-ink">{filler}</bdi>
                          ) : ownerId ? (
                            // Nobody picked (or no role): the usual default, the project's owner.
                            <span title="The project’s owner">Owner{ownerName ? ` (${ownerName})` : ''}</span>
                          ) : (
                            <span>Unassigned</span>
                          )}
                          {role ? <span className="text-ink-3"> · {role.name}</span> : null}
                        </span>
                        {t.checklistCount ? <span className="flex-none text-xs text-ink-3">{count(t.checklistCount, 'checklist item')}</span> : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
