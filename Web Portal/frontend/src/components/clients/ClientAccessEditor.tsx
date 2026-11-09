import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { CLIENT_PROJECT_OPTIONS_KEY, clientsApi, type ClientRole } from '../../api/clients';
import type { ClientPreviewSpec } from '../../api/portal';
import type { ApiProject } from '../../api/projects';
import { ProjectAvatar } from '../ProjectAvatar';
import { ClientPreviewDialog } from '../portal/ClientPreviewDialog';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LoadError } from '../ui/LoadError';
import { ModalPortal } from '../ui/ModalPortal';
import { SearchableSelect, type SelectOption } from '../ui/SearchableSelect';
import { useTwoColumns } from '../ui/dialog-size';
import {
  LADDER,
  NO_MODULE_ROW,
  PERMISSIONS,
  ROLES,
  ROLE_SETS,
  ROLE_WORDS,
  grantsOf,
  hasModule,
  isTicked,
  newRow,
  previewBlocked,
  roleAbout,
  tickOpen,
  withRole,
  withRoleForAll,
  withTick,
  type AccessRow,
  type Permission,
} from './client-access';

/** Whose portal "Preview as client" shows: a saved client's id and/or the details typed so far (the projects are the matrix on screen). */
export type ClientPreviewWho = Omit<ClientPreviewSpec, 'projects'>;

export interface ClientAccessEditorProps {
  /** The projects on the account, each with its role and ticks. */
  value: AccessRow[];
  onChange: (rows: AccessRow[]) => void;
  /** Makes the ids of its fields unique on the page. */
  idPrefix: string;
  /** After a save attempt: a Custom project with neither view is marked on its view ticks. */
  showErrors?: boolean;
  /** 'section': a heading like the other sections of Manage account; 'field' (default): a form field's label. */
  variant?: 'field' | 'section';
  /**
   * 1.23.7: offer "Preview as client" for this client — the Client portal as the matrix on screen would give
   * it, before anything is saved or sent (read-only; it never signs in as them).
   */
  preview?: ClientPreviewWho;
}

/** A finger-sized target on a touch screen ('!': over the base rule's 32px for every button; a box stays 16px). */
const TOUCH = '[@media(pointer:coarse)]:!min-h-11';
const TICK_ROW = `flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${TOUCH} [@media(pointer:coarse)]:items-center`;
const BOX = 'h-4 w-4 flex-none accent-brand disabled:opacity-50';
const SELECT = `rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${TOUCH}`;
const SMALL_BUTTON = `inline-flex items-center rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink ${TOUCH}`;
const REMOVE = `flex-none rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger ${TOUCH}`;
const SUBHEAD = 'text-xs font-semibold text-ink-2';
const EMPTY = 'Add a project to give access';

/**
 * The table's top header row: which role first brings each permission (PERMISSIONS is in ladder order —
 * Viewer's four, then what Contributor adds, then what Approver adds). A divider starts each group.
 */
const LADDER_GROUPS = LADDER.map((role, i) => {
  const below = LADDER[i - 1];
  return { role, label: below ? `${ROLE_WORDS[role]} adds` : ROLE_WORDS[role], span: ROLE_SETS[role].length - (below ? ROLE_SETS[below].length : 0) };
});
const GROUP_STARTS = new Set(LADDER.slice(0, -1).map((r) => ROLE_SETS[r].length));

/**
 * A client's project access (1.23; a permission matrix since 1.23.7) — the one editor for New user with
 * Role "Client", Manage account on a client and the Clients page. Always on screen, before any project:
 * what each role includes and the eight permissions. Pick projects (searchable, from the live,
 * non-archived ones); per project a role — Viewer, Contributor, Approver, or Custom — and the eight
 * ticks. A project just added starts as Viewer. Picking a role ticks its set; changing a tick makes the
 * row Custom. A tick whose view is off is greyed out with a short hint, and unticked: the server would
 * save it off anyway. A Custom row needs at least one view. "Same for all projects" sets one role on
 * every row. From 1024px (where its dialogs give it their full width) a table, one row per project;
 * narrower, one card per project.
 */
export function ClientAccessEditor({ value, onChange, idPrefix, showErrors = false, variant = 'field', preview }: ClientAccessEditorProps) {
  const qc = useQueryClient();
  const table = useTwoColumns();
  // The spec is taken when Preview opens (the matrix can't change behind the preview).
  const [previewSpec, setPreviewSpec] = useState<ClientPreviewSpec | null>(null);
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

  const replace = (next: AccessRow) => onChange(value.map((r) => (r.projectId === next.projectId ? next : r)));
  const add = (id: string) => {
    const o = options.find((x) => x.id === id);
    if (o && !added.has(id)) onChange([...value, newRow(o)]);
  };
  const remove = (projectId: string) => onChange(value.filter((r) => r.projectId !== projectId));
  const blocked = previewBlocked(value);

  const rowId = (row: AccessRow) => `${idPrefix}-${row.projectId}`;
  const missingId = (row: AccessRow) => `${rowId(row)}-missing`;

  /** One permission's box for a project: a table cell (named by its column and the project) or a labelled row on a card. */
  const tick = (row: AccessRow, p: Permission, look: 'cell' | 'row', divided = false) => {
    const id = `${rowId(row)}-${p.key}`;
    const open = tickOpen(row, p.key);
    const missing = p.needs.length === 0 && !hasModule(row);
    const input = (
      <input
        id={id}
        type="checkbox"
        checked={open && isTicked(row, p.key)}
        disabled={!open}
        onChange={(e) => replace(withTick(row, p.key, e.target.checked))}
        aria-invalid={missing && showErrors ? true : undefined}
        aria-describedby={!open ? `${id}-hint` : missing ? missingId(row) : undefined}
        {...(look === 'cell' ? { 'aria-label': `${p.label} — ${row.name}` } : {})}
        className={look === 'row' ? `${BOX} mt-0.5 [@media(pointer:coarse)]:mt-0` : BOX}
      />
    );
    if (look === 'cell') {
      return (
        <td key={p.key} className={`p-0 text-center align-middle ${divided ? 'border-s border-line' : ''}`}>
          <label title={open ? undefined : (p.hint ?? undefined)} className={`flex min-h-10 w-full items-center justify-center ${open ? 'cursor-pointer hover:bg-ground' : 'cursor-not-allowed'} ${TOUCH}`}>
            {input}
          </label>
          {open ? null : (
            <span id={`${id}-hint`} className="sr-only">
              {p.hint}
            </span>
          )}
        </td>
      );
    }
    return (
      <div key={p.key} className="flex min-w-0 flex-col">
        <label className={`${TICK_ROW} ${open ? 'cursor-pointer text-ink hover:bg-ground' : 'cursor-not-allowed text-ink-3'}`}>
          {input}
          <span className="min-w-0">
            {p.label}
            <span className="sr-only"> — {row.name}</span>
          </span>
        </label>
        {open ? null : (
          <span id={`${id}-hint`} className="-mt-1 ps-[2.125rem] text-[11px] text-ink-3">
            {p.hint}
          </span>
        )}
      </div>
    );
  };

  const projectName = (row: AccessRow, size: 'sm' | 'md') => (
    <div className="flex min-w-0 items-start gap-2.5">
      <ProjectAvatar project={lookOf(row.projectId, row.name)} size={size} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <bdi id={`${rowId(row)}-name`} className="font-semibold text-ink [overflow-wrap:anywhere]">{row.name}</bdi>
          {row.archived ? <Badge>Archived</Badge> : null}
        </p>
        <p className="text-xs text-ink-2 [overflow-wrap:anywhere]">
          <span className="font-mono">{row.code}</span>
          {row.company ? <> · <bdi>{row.company}</bdi></> : null}
        </p>
        {row.archived ? <p className="mt-0.5 text-xs text-ink-2">Archived: hidden in the Client portal until it’s unarchived.</p> : null}
      </div>
    </div>
  );

  // A Custom row with neither view: said on the row (warning until a save attempt, then a problem).
  const missingNote = (row: AccessRow) =>
    hasModule(row) ? null : (
      <p id={missingId(row)} className={`mt-1.5 rounded-lg px-2 py-1 text-xs ${showErrors ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
        {NO_MODULE_ROW}
      </p>
    );

  const roleSelect = (row: AccessRow, labelled: boolean) => (
    <select
      id={`${rowId(row)}-role`}
      value={row.role}
      onChange={(e) => replace(withRole(row, e.target.value as ClientRole))}
      {...(labelled ? {} : { 'aria-label': `Role — ${row.name}` })}
      className={`${SELECT} w-full`}
    >
      {ROLES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
  );

  const removeButton = (row: AccessRow) => (
    <button type="button" onClick={() => remove(row.projectId)} aria-label={`Remove ${row.name}`} title="Take this project off their access" className={REMOVE}>
      Remove
    </button>
  );

  // What each role includes: always on screen, so the roles mean something before the first project.
  const legend = (
    <ul aria-label="What each role includes" className="grid gap-x-4 gap-y-1 rounded-lg bg-ground px-3 py-2 text-xs text-ink-2 sm:grid-cols-2">
      {ROLES.map((r) => (
        <li key={r.value} className="min-w-0">
          <span className="font-semibold text-ink">{r.label}</span> — {roleAbout(r.value)}
        </li>
      ))}
    </ul>
  );

  const sameForAll =
    value.length >= 2 ? (
      <div role="group" aria-labelledby={`${idPrefix}-all`} className="flex flex-wrap items-center gap-1.5">
        <span id={`${idPrefix}-all`} className="me-1 text-xs font-semibold text-ink-2">
          Same for all projects
        </span>
        {LADDER.map((r) => (
          <button key={r} type="button" onClick={() => onChange(withRoleForAll(value, r))} aria-label={`${ROLE_WORDS[r]} for every project`} title={`Make every project ${ROLE_WORDS[r]}`} className={SMALL_BUTTON}>
            {ROLE_WORDS[r]}
          </button>
        ))}
      </div>
    ) : null;

  const previewControl = preview ? (
    <div className="flex flex-none flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!!blocked}
        aria-describedby={blocked ? `${idPrefix}-preview-why` : undefined}
        onClick={() => setPreviewSpec({ ...preview, projects: grantsOf(value) })}
        className={TOUCH}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.8" />
        </svg>
        Preview as client
      </Button>
      {blocked ? (
        <p id={`${idPrefix}-preview-why`} className="text-[11px] text-ink-3">
          {blocked}
        </p>
      ) : null}
    </div>
  ) : null;

  const matrixTable = (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <caption className="sr-only">Permissions for each project</caption>
        <thead className="bg-ground/60 text-ink-2">
          <tr>
            <th scope="col" rowSpan={2} className="w-[13rem] px-3 py-2 text-left align-bottom text-xs font-semibold">
              Project
            </th>
            <th scope="col" rowSpan={2} className="w-[8.5rem] px-2 py-2 text-left align-bottom text-xs font-semibold">
              Role
            </th>
            {LADDER_GROUPS.map((g, i) => (
              <th key={g.role} scope="colgroup" colSpan={g.span} className={`px-2 pt-2 text-center text-[10px] font-bold uppercase tracking-wider text-ink-3 ${i > 0 ? 'border-s border-line' : ''}`}>
                {g.label}
              </th>
            ))}
            <th scope="col" rowSpan={2} className="px-2 py-2">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
          <tr>
            {PERMISSIONS.map((p, i) => (
              <th key={p.key} scope="col" className={`px-1.5 pb-2 pt-1 text-center align-bottom text-[11px] font-semibold leading-tight ${GROUP_STARTS.has(i) ? 'border-s border-line' : ''}`}>
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.length === 0 ? (
            <tr className="border-t border-line">
              <td colSpan={PERMISSIONS.length + 3} className="px-3 py-6 text-center text-sm text-ink-2">
                {EMPTY}
              </td>
            </tr>
          ) : (
            value.map((row) => (
              <tr key={row.projectId} className={`border-t border-line align-middle ${!hasModule(row) && showErrors ? 'bg-danger-soft/40' : ''}`}>
                <td className="px-3 py-2">
                  {projectName(row, 'sm')}
                  {missingNote(row)}
                </td>
                <td className="px-2 py-2">{roleSelect(row, false)}</td>
                {PERMISSIONS.map((p, i) => tick(row, p, 'cell', GROUP_STARTS.has(i)))}
                <td className="px-2 py-2 text-right">{removeButton(row)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const cards =
    value.length === 0 ? (
      <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-ink-2">{EMPTY}</p>
    ) : (
      <ul aria-label="Their projects" className="flex flex-col gap-3">
        {value.map((row) => (
          <li key={row.projectId}>
            <fieldset aria-labelledby={`${rowId(row)}-name`} className={`min-w-0 rounded-xl border p-3 ${!hasModule(row) && showErrors ? 'border-danger/60' : 'border-line'} bg-surface`}>
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">{projectName(row, 'md')}</div>
                {removeButton(row)}
              </div>
              <div className="mt-3 flex flex-col gap-1 sm:max-w-[16rem]">
                <label htmlFor={`${rowId(row)}-role`} className={SUBHEAD}>
                  Role<span className="sr-only"> — {row.name}</span>
                </label>
                {roleSelect(row, true)}
              </div>
              {missingNote(row)}
              <div role="group" aria-labelledby={`${rowId(row)}-ticks`} className="mt-3">
                <p id={`${rowId(row)}-ticks`} className={SUBHEAD}>
                  What they may see and do
                </p>
                <div className="mt-1 grid grid-cols-2 gap-x-3 sm:grid-cols-4">{PERMISSIONS.map((p) => tick(row, p, 'row'))}</div>
              </div>
            </fieldset>
          </li>
        ))}
      </ul>
    );

  const titleClass = variant === 'section' ? 'mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2' : 'text-sm font-medium text-ink';
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={`${idPrefix}-about`}>
      <legend className={titleClass}>Project access</legend>
      <div className="-mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p id={`${idPrefix}-about`} className="min-w-0 flex-1 basis-64 text-xs text-ink-2">
          The projects they may open in the Client portal, and what they may see and do in each: pick a role, or tick the boxes yourself.
        </p>
        {previewControl}
      </div>
      {legend}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="w-full min-w-0 sm:max-w-sm">
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
        </div>
        {sameForAll}
      </div>

      {table ? matrixTable : cards}

      {previewSpec ? (
        <ModalPortal>
          {/* React passes events from a portal up to its parents: a submit inside the preview must never reach
              the account's form around this editor (and create or save it). */}
          <div className="contents" onSubmit={(e) => e.stopPropagation()}>
            <ClientPreviewDialog spec={previewSpec} onClose={() => setPreviewSpec(null)} />
          </div>
        </ModalPortal>
      ) : null}
    </fieldset>
  );
}
