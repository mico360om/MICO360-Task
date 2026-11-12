import { useEffect, useId, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { guestsApi, type ApiGuest } from '../../api/guests';
import { ApiError } from '../../lib/api-client';
import { GUEST_LIMITS, GUEST_WORDS, MAX_TASK_GUESTS, checkGuest, guestLabel, type GuestDraft, type GuestField } from '../../lib/guest-contacts';
import { TOUCH_TALL } from '../../lib/touch';
import { FieldError, FieldLabel, fieldClass } from '../ui/Field';
import { ComboPicker } from '../task-drawer/combo-picker';
import { useOwnEscape } from '../task-drawer/save-state';

/**
 * 1.24 Guests: the parts of the Assign box that pick people outside the company — the "Internal user |
 * Guest" switch, the search of the project's company guest list, and the New guest form with its
 * duplicate check. Shared by the New / Edit task form and the task panel; nothing here saves a task.
 */

export type AssignMode = 'internal' | 'guest';

/** A guest as a task form or panel holds one (an ApiGuest, a task's guest, or a row's short one). */
export interface PickedGuest {
  id: string;
  name: string;
  company: string | null;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
}

export const pickedGuest = (g: { id: string; name: string; company?: string | null; designation?: string | null; email?: string | null; phone?: string | null }): PickedGuest => ({
  id: g.id,
  name: g.name,
  company: g.company ?? null,
  designation: g.designation ?? null,
  email: g.email ?? null,
  phone: g.phone ?? null,
});

/** "Ahmed Al Harthy · OXY": the name and company as a chip shows them. */
export const guestChipText = (g: { name: string; company?: string | null }) => (g.company ? `${g.name} · ${g.company}` : g.name);

/** The small "Guest" mark beside a guest's name. */
export function GuestBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex flex-none items-center rounded bg-info-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-info ${className}`}>
      {GUEST_WORDS.badge}
    </span>
  );
}

/**
 * Assign an "Internal user" (a person on the project's team) or a "Guest" (from the company's guest
 * list): a segmented switch with the radio group's keys — Tab reaches the chosen one, arrows change it.
 */
export function AssignModeSwitch({ mode, onChange, disabled = false }: { mode: AssignMode; onChange: (mode: AssignMode) => void; disabled?: boolean }) {
  const modes: AssignMode[] = ['internal', 'guest'];
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div role="radiogroup" aria-label={GUEST_WORDS.modeLabel} className="inline-flex max-w-full self-start rounded-lg border border-line bg-ground p-0.5">
      {modes.map((m, i) => {
        const on = mode === m;
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(m)}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault();
              const next = (i + 1) % modes.length;
              onChange(modes[next]!);
              refs.current[next]?.focus();
            }}
            className={`inline-flex h-8 min-w-0 items-center justify-center rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${TOUCH_TALL} ${
              on ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {m === 'internal' ? GUEST_WORDS.internal : GUEST_WORDS.guest}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pick a guest: a search of the project's company guest list (name, company, email or phone; the
 * first 50 A to Z before anything is typed), and "+ New guest" to add someone who isn't on it yet.
 * Guests in `exclude` (already picked) aren't offered.
 */
export function GuestPicker({
  projectId,
  exclude,
  onPick,
  disabled = false,
  alwaysOpen = false,
  autoFocus = false,
  onClose,
}: {
  projectId: string;
  exclude: string[];
  onPick: (guest: PickedGuest) => void;
  disabled?: boolean;
  /** Keep the list showing (inside the task panel's picking box). */
  alwaysOpen?: boolean;
  autoFocus?: boolean;
  /** Escape with nothing typed (the panel's picking box closes). */
  onClose?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ApiGuest[]>([]);
  const [searching, setSearching] = useState(true);
  // The New guest form, with the name to start from.
  const [adding, setAdding] = useState<string | null>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    setSearching(true);
    const timer = setTimeout(
      () => {
        guestsApi(apiClient)
          .forProject(projectId, query)
          .then(
            (list) => {
              if (!live) return;
              setFound(Array.isArray(list) ? list : []);
              setSearching(false);
            },
            () => {
              if (!live) return;
              setFound([]);
              setSearching(false);
            },
          );
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, query]);

  if (exclude.length >= MAX_TASK_GUESTS) return <p className="text-xs text-ink-2">{GUEST_WORDS.full}</p>;
  if (adding !== null) {
    return (
      <NewGuestForm
        projectId={projectId}
        initialName={adding}
        onDone={(g) => {
          setAdding(null);
          setQuery('');
          onPick(pickedGuest(g));
        }}
        onCancel={() => {
          setAdding(null);
          setTimeout(() => newRef.current?.focus(), 0);
        }}
      />
    );
  }
  const offered = found.filter((g) => !exclude.includes(g.id) && !g.retiredAt);
  return (
    <div className="flex flex-col gap-1.5">
      <ComboPicker
        label={GUEST_WORDS.search}
        placeholder={GUEST_WORDS.search}
        query={query}
        onQuery={setQuery}
        openOnFocus
        inline
        alwaysOpen={alwaysOpen}
        autoFocus={autoFocus}
        onClose={onClose}
        disabled={disabled || !projectId}
        options={offered.map((g) => {
          const reach = [g.email, g.phone].filter(Boolean).join(' · ');
          return {
            id: g.id,
            label: guestLabel(g),
            trail: reach ? (
              <span dir="ltr" className="max-w-[45%] flex-none truncate text-xs text-ink-2">
                {' '}
                {reach}
              </span>
            ) : undefined,
          };
        })}
        emptyText={searching ? 'Searching…' : query.trim() ? GUEST_WORDS.noMatch : GUEST_WORDS.none}
        onPick={(id) => {
          const g = offered.find((x) => x.id === id);
          if (!g) return;
          setQuery('');
          onPick(pickedGuest(g));
        }}
      />
      <button
        ref={newRef}
        type="button"
        onClick={() => setAdding(query.trim())}
        disabled={disabled || !projectId}
        className={`inline-flex h-9 items-center gap-1 self-start rounded-lg px-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/10 disabled:opacity-60 ${TOUCH_TALL}`}
      >
        <span aria-hidden="true">+</span>
        {GUEST_WORDS.newGuest}
      </button>
    </div>
  );
}

type Fields = Record<GuestField, string>;
const ORDER: GuestField[] = ['name', 'company', 'designation', 'email', 'phone'];
const blank = (name: string): Fields => ({ name, company: '', designation: '', email: '', phone: '' });
/** What the duplicate check is sent: trimmed, a blank field left out as null. */
const draftOf = (f: Fields): GuestDraft => Object.fromEntries(ORDER.map((k) => [k, f[k].trim() || null])) as GuestDraft;

/** Why a save failed, in words (the server's own sentence when it sent one). */
function reasonOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return err.message && !/^Request failed/.test(err.message) ? err.message : 'You don’t have permission to do that.';
    if (err.message && !/^Request failed/.test(err.message)) return err.message;
    return 'Couldn’t add the guest. Please try again.';
  }
  return 'Couldn’t add the guest. Check your connection and try again.';
}

/**
 * A new guest on the company's list: the name (required), company, designation, email and phone,
 * checked as they are typed against the list — the same person already there is offered instead
 * ("… is already on the list — use them?"), guests with the same name are listed. Not a <form> (it
 * sits inside the task form): Add guest is a plain button and Enter in a box adds.
 */
export function NewGuestForm({
  projectId,
  initialName = '',
  onDone,
  onCancel,
}: {
  projectId: string;
  initialName?: string;
  /** The guest added (or the one on the list chosen instead). */
  onDone: (guest: ApiGuest) => void;
  onCancel: () => void;
}) {
  const base = useId();
  const [draft, setDraft] = useState<Fields>(() => blank(initialName));
  const [problems, setProblems] = useState<Partial<Record<GuestField, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [same, setSame] = useState<ApiGuest[]>([]);
  const [similar, setSimilar] = useState<ApiGuest[]>([]);
  // "No, add a new guest": the duplicate warning is answered (until the details change).
  const [confirmNew, setConfirmNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Partial<Record<GuestField, HTMLInputElement | null>>>({});
  const changed = ORDER.some((f) => draft[f] !== blank(initialName)[f]);
  useOwnEscape(rootRef, () => {
    if (!saving) onCancel();
  });
  useEffect(() => {
    refs.current.name?.focus();
  }, []);

  // The live duplicate check, a moment after typing stops.
  useEffect(() => {
    if (!draft.name.trim() || !projectId) {
      setSame([]);
      setSimilar([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      guestsApi(apiClient)
        .check(projectId, draftOf(draft))
        .then(
          (r) => {
            if (!live) return;
            setSame(Array.isArray(r?.same) ? r.same : []);
            setSimilar(Array.isArray(r?.similar) ? r.similar : []);
          },
          () => undefined,
        );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, draft.name, draft.company, draft.email, draft.phone]);

  const set = (f: GuestField, v: string) => {
    setDraft((d) => ({ ...d, [f]: v }));
    if (f !== 'designation') setConfirmNew(false);
    if (problems[f]) setProblems((p) => ({ ...p, [f]: undefined }));
  };
  const focusFirst = (p: Partial<Record<GuestField, string>>) => {
    const first = ORDER.find((f) => p[f]);
    if (first) refs.current[first]?.focus();
  };

  async function save() {
    if (saving) return;
    setMessage(null);
    const check = checkGuest(draftOf(draft));
    if (!check.ok) {
      setProblems(check.problems);
      focusFirst(check.problems);
      return;
    }
    setSaving(true);
    try {
      const made = await guestsApi(apiClient).create(projectId, { ...check.guest, ...(confirmNew ? { confirmNew: true } : {}) });
      onDone(made);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'GUEST_DUPLICATE') {
        const matches = (err.details as { matches?: ApiGuest[] } | undefined)?.matches;
        if (Array.isArray(matches) && matches.length > 0) setSame(matches);
        else setMessage(reasonOf(err));
        setConfirmNew(false);
      } else {
        const fields = err instanceof ApiError ? ((err.details as { fields?: Partial<Record<GuestField, string>> } | undefined)?.fields ?? {}) : {};
        if (Object.keys(fields).length > 0) {
          setProblems(fields);
          focusFirst(fields);
        } else setMessage(reasonOf(err));
      }
    } finally {
      setSaving(false);
    }
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    void save();
  };

  const idOf = (f: GuestField) => `${base}-${f}`;
  const errorId = (f: GuestField) => `${base}-${f}-error`;
  const box = (f: GuestField, type: 'text' | 'email' | 'tel', className = '') => (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <FieldLabel htmlFor={idOf(f)} required={f === 'name'}>
        {GUEST_WORDS.labels[f]}
      </FieldLabel>
      <input
        ref={(el) => {
          refs.current[f] = el;
        }}
        id={idOf(f)}
        type={type}
        dir={type === 'text' ? 'auto' : 'ltr'}
        autoComplete="off"
        inputMode={type === 'email' ? 'email' : type === 'tel' ? 'tel' : undefined}
        value={draft[f]}
        maxLength={GUEST_LIMITS[f] + 20}
        aria-required={f === 'name' ? true : undefined}
        aria-invalid={problems[f] ? true : undefined}
        aria-describedby={problems[f] ? errorId(f) : undefined}
        onChange={(e) => set(f, e.target.value)}
        onKeyDown={onEnter}
        className={fieldClass(Boolean(problems[f]), 'h-10 w-full sm:h-9')}
      />
      <FieldError id={errorId(f)}>{problems[f]}</FieldError>
    </div>
  );
  const usable = (g: ApiGuest) => !g.retiredAt;
  const first = same[0];
  const softly = similar.filter((g) => !same.some((s) => s.id === g.id));

  return (
    <div ref={rootRef} role="group" aria-labelledby={`${base}-title`} data-guest-form="" data-unsaved={changed || undefined} className="rounded-xl border border-line bg-ground/40 p-3">
      <h4 id={`${base}-title`} className="mb-2 text-sm font-semibold text-ink">
        {GUEST_WORDS.newGuest}
      </h4>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {box('name', 'text', 'sm:col-span-2')}
        {box('company', 'text')}
        {box('designation', 'text')}
        {box('email', 'email')}
        {box('phone', 'tel')}
      </div>
      {first && !confirmNew ? (
        <div role="status" className="mt-2.5 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-ink">
          <p className="font-medium">{GUEST_WORDS.useExisting(guestLabel(first))}</p>
          {[first.designation, first.email, first.phone].some(Boolean) ? (
            <p dir="auto" className="mt-0.5 text-xs text-ink-2">
              {[first.designation, first.email, first.phone].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {!usable(first) ? <p className="mt-0.5 text-xs text-ink-2">{GUEST_WORDS.retired} — an admin can use them again on {GUEST_WORDS.adminTitle}.</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {usable(first) ? (
              <button
                type="button"
                onClick={() => onDone(first)}
                className={`h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:brightness-95 ${TOUCH_TALL}`}
              >
                {GUEST_WORDS.useThem}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setConfirmNew(true)}
              className={`h-9 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-ground ${TOUCH_TALL}`}
            >
              {GUEST_WORDS.addAnyway}
            </button>
          </div>
        </div>
      ) : null}
      {softly.length > 0 && (!first || confirmNew) ? (
        <div className="mt-2.5 rounded-lg bg-surface px-3 py-2 text-xs text-ink-2">
          <p>{GUEST_WORDS.similar}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {softly.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2">
                <span dir="auto" className="min-w-0 flex-1 truncate text-ink">
                  {guestLabel(g)}
                  {[g.email, g.phone].some(Boolean) ? <span className="text-ink-2"> · {[g.email, g.phone].filter(Boolean).join(' · ')}</span> : null}
                </span>
                {usable(g) ? (
                  <button
                    type="button"
                    onClick={() => onDone(g)}
                    aria-label={`Use ${guestLabel(g)}`}
                    className={`h-8 rounded-md px-2 text-xs font-semibold text-brand transition-colors hover:bg-brand/10 ${TOUCH_TALL}`}
                  >
                    Use
                  </button>
                ) : (
                  <span className="text-ink-3">{GUEST_WORDS.retired}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? (
        <p role="alert" className="mt-2 rounded-md bg-danger-soft px-2 py-1 text-xs font-medium text-danger">
          {message}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={`h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60 ${TOUCH_TALL}`}
        >
          {saving ? 'Adding…' : 'Add guest'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={`h-9 rounded-lg px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-ground disabled:opacity-60 ${TOUCH_TALL}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
