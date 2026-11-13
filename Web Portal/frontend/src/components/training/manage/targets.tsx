import { useId, useMemo, useState } from 'react';
import type { ManageCourseRow, TargetKind, TargetOptions } from '../../../api/training';
import { LIMITS, MODULE_LABELS } from '../../../api/training';
import { SearchableSelect, type SelectOption } from '../../ui/SearchableSelect';
import { fieldClass } from '../../ui/Field';
import { LoadError } from '../../ui/LoadError';
import { ChoiceGroup } from './ManageDialog';
import { TARGET_KIND_LABELS } from './manage-ui';

/** The picker's choices for one kind of target (people say their email; clients are marked). */
export function targetChoices(kind: TargetKind, options: TargetOptions | undefined): SelectOption[] {
  if (!options) return [];
  switch (kind) {
    case 'USER':
      return options.people.map((p) => ({ value: p.id, label: p.name, hint: p.client ? `Client · ${p.email}` : p.email }));
    case 'GROUP':
      return options.groups.map((g) => ({ value: g.key, label: g.label }));
    case 'DEPARTMENT':
      return options.departments.map((d) => ({ value: d.id, label: d.name }));
    case 'COMPANY':
      return options.companies.map((c) => ({ value: c.id, label: c.name }));
    case 'PROJECT':
      return options.projects.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }));
  }
}

const EMPTY: Record<TargetKind | 'PEOPLE', string> = {
  USER: 'No people you can assign to.',
  PEOPLE: 'No people you can assign to.',
  GROUP: 'No groups.',
  DEPARTMENT: 'No departments yet: give people a Department in User Management.',
  COMPANY: 'No companies you can assign to.',
  PROJECT: 'No live projects you can assign to.',
};

/** Who a course is meant for: staff courses reach staff, a Clients course clients; a mix can reach both. */
export type PeopleAudience = 'STAFF' | 'CLIENTS' | 'ALL';

/** Several people from the Assign window's list (search, tick) with their chips: the picker's people. */
export function PeoplePicker({ options, value, onChange, audience }: { options: TargetOptions | undefined; value: string[]; onChange: (ids: string[]) => void; audience: PeopleAudience }) {
  const searchId = useId();
  const [q, setQ] = useState('');
  const everyone = useMemo(() => options?.people ?? [], [options]);
  const offered = useMemo(() => everyone.filter((p) => (audience === 'ALL' ? true : audience === 'CLIENTS' ? p.client : !p.client)), [everyone, audience]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? offered.filter((p) => p.name.toLowerCase().includes(t) || p.email.toLowerCase().includes(t)) : offered;
  }, [offered, q]);
  const full = value.length >= LIMITS.peoplePerAssignment;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const chosen = value.map((id) => everyone.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-semibold text-ink">
        People
        <span className="font-normal text-ink-2" aria-hidden="true"> · </span>
        <span className="font-normal text-ink-2">{value.length === 1 ? '1 person chosen' : `${value.length.toLocaleString('en-US')} people chosen`}</span>
      </legend>
      {options && offered.length === 0 ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">{EMPTY.PEOPLE}</p>
      ) : (
        <>
          {chosen.length ? (
            <ul aria-label="Chosen people" className="mb-2 flex flex-wrap gap-1.5">
              {chosen.map((p) => (
                <li key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-ground ps-3 text-sm text-ink">
                  <span dir="auto" className="min-w-0 truncate">{p.name}</span>
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => toggle(p.id)} className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-ink-2 hover:text-ink [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11">
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label htmlFor={searchId} className="sr-only">Find a person</label>
          <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" disabled={!options} className={fieldClass(false, 'mb-2 w-full')} />
          <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {shown.map((p) => {
              const on = value.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-ground [@media(pointer:coarse)]:!min-h-11">
                    <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(p.id)} className="mt-0.5 h-4 w-4 flex-none accent-brand" />
                    <span className="min-w-0">
                      <span dir="auto" className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{p.name}</span>
                      <span dir="auto" className="block text-xs text-ink-2 [overflow-wrap:anywhere]">{p.client ? `Client · ${p.email}` : p.email}</span>
                    </span>
                  </label>
                </li>
              );
            })}
            {shown.length === 0 && options ? <li className="px-3 py-2 text-sm text-ink-2">No one matches.</li> : null}
          </ul>
          {full ? <p className="mt-1 text-xs text-ink-2">{`That is the most one assignment can take (${LIMITS.peoplePerAssignment.toLocaleString('en-US')}).`}</p> : null}
        </>
      )}
    </fieldset>
  );
}

/** Who it is for: the kind (People, Person, Group, Department, Company, Project — or the rule's three) and the one chosen (or the ticked people). */
export function TargetPicker<K extends TargetKind | 'PEOPLE'>({ kinds, kind, onKind, targetId, onTarget, options, name, invalid, userIds, onUserIds, audience = 'ALL' }: { kinds: readonly K[]; kind: K; onKind: (k: K) => void; targetId: string; onTarget: (id: string) => void; options: TargetOptions | undefined; name: string; invalid?: boolean; userIds?: string[]; onUserIds?: (ids: string[]) => void; audience?: PeopleAudience }) {
  const choices = kind === 'PEOPLE' ? [] : targetChoices(kind, options);
  const label = `${TARGET_KIND_LABELS[kind]} to assign`;
  return (
    <div className="flex flex-col gap-2">
      <ChoiceGroup<K>
        legend="Who it is for"
        name={name}
        value={kind}
        onChange={(k) => {
          onKind(k);
          onTarget('');
        }}
        options={kinds.map((k) => ({ value: k, label: TARGET_KIND_LABELS[k] }))}
      />
      {kind === 'PEOPLE' ? (
        <PeoplePicker options={options} value={userIds ?? []} onChange={onUserIds ?? (() => undefined)} audience={audience} />
      ) : options && choices.length === 0 ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">{EMPTY[kind]}</p>
      ) : (
        <SearchableSelect size="lg" ariaLabel={label} options={choices} value={targetId} onChange={onTarget} placeholder={`Choose a ${TARGET_KIND_LABELS[kind].toLowerCase()}…`} invalid={invalid} disabled={!options} />
      )}
    </div>
  );
}

/** Tick one or more courses (published ones: only those can be assigned), with a search when there are many. */
export function CourseChecklist({ courses, value, onChange, loading, failed, onRetry, legend = 'Courses' }: { courses: ManageCourseRow[]; value: string[]; onChange: (ids: string[]) => void; loading?: boolean; failed?: boolean; onRetry?: () => void; legend?: string }) {
  const searchId = useId();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? courses.filter((c) => c.title.toLowerCase().includes(t) || value.includes(c.id)) : courses;
  }, [courses, q, value]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-semibold text-ink">
        {legend}
        {value.length ? <span className="font-normal text-ink-2"> · {value.length} chosen</span> : null}
      </legend>
      {failed ? (
        <LoadError what="the courses" onRetry={onRetry} />
      ) : loading ? (
        <div className="skeleton h-24 rounded-lg" aria-hidden="true" />
      ) : courses.length === 0 ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">No published courses yet. Only published courses can be assigned: publish one in its editor first.</p>
      ) : (
        <>
          {courses.length > 6 ? (
            <>
              <label htmlFor={searchId} className="sr-only">Find a course</label>
              <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a course" className={fieldClass(false, 'mb-2 w-full')} />
            </>
          ) : null}
          <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {shown.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-ground [@media(pointer:coarse)]:!min-h-11">
                  <input type="checkbox" aria-label={c.title} checked={value.includes(c.id)} onChange={() => toggle(c.id)} className="mt-0.5 h-4 w-4 flex-none accent-brand" />
                  <span className="min-w-0">
                    <span dir="auto" className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{c.title}</span>
                    <span className="block text-xs text-ink-2">{MODULE_LABELS[c.moduleKey]}{c.audience === 'CLIENTS' ? ' · Clients' : ''}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}
