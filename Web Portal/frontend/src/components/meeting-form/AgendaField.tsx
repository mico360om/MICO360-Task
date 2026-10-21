import { useState, type KeyboardEvent } from 'react';
import { fieldClass } from '../ui/Field';
import { Icon } from '../meeting/kit';

/** An agenda item in the new-meeting form, before the meeting is saved. */
export interface AgendaDraft {
  /** Stable while the item is edited or moved (not saved). */
  key: string;
  title: string;
  ownerId: string | null;
  minutes: number | null;
}

let seq = 0;
export const newAgendaKey = () => `draft-${Date.now().toString(36)}-${++seq}`;
const minutesValue = (v: string): number | null => (v.trim() === '' ? null : Math.min(600, Math.max(1, Math.round(Number(v)) || 1)));
const iconButton = 'grid h-9 w-9 flex-none place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink disabled:opacity-30';

/**
 * The new-meeting form's Agenda: topics in order, each with a lead (one of the invited people or the
 * organizer) and minutes, totalled against the meeting's length.
 */
export function AgendaField({
  value,
  onChange,
  leads,
  minutes,
}: {
  value: AgendaDraft[];
  onChange: (next: AgendaDraft[]) => void;
  leads: Array<{ id: string; name: string }>;
  /** The meeting's length. */
  minutes: number;
}) {
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const planned = value.reduce((s, i) => s + (i.minutes ?? 0), 0);
  const over = planned > minutes;

  const patch = (key: string, change: Partial<AgendaDraft>) => onChange(value.map((i) => (i.key === key ? { ...i, ...change } : i)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  };
  const add = () => {
    if (!title.trim()) return setProblem('Enter an agenda item.');
    setProblem(null);
    onChange([...value, { key: newAgendaKey(), title: title.trim(), ownerId: null, minutes: null }]);
    setTitle('');
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // adds the item; doesn't send the form
    add();
  };

  return (
    <fieldset role="group" aria-label="Agenda" className="flex flex-col gap-2 rounded-2xl border border-line p-3.5">
      <legend className="px-1 text-sm font-semibold text-ink">Agenda</legend>
      {value.length ? (
        <>
          <ol className="flex flex-col gap-2">
            {value.map((item, index) => {
              const n = index + 1;
              return (
                <li key={item.key} className="flex flex-col gap-1.5 rounded-xl border border-line bg-ground/40 p-2">
                  <input aria-label={`Agenda item ${n}`} dir="auto" value={item.title} onChange={(e) => patch(item.key, { title: e.target.value })} className={fieldClass(!item.title.trim())} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select aria-label={`Lead for item ${n}`} value={item.ownerId ?? ''} onChange={(e) => patch(item.key, { ownerId: e.target.value || null })} className={`${fieldClass(false)} min-w-0 flex-1`}>
                      <option value="">No lead</option>
                      {leads.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <input
                      aria-label={`Minutes for item ${n}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={600}
                      value={item.minutes ?? ''}
                      onChange={(e) => patch(item.key, { minutes: minutesValue(e.target.value) })}
                      placeholder="min"
                      className={`${fieldClass(false)} w-20`}
                    />
                    <button type="button" aria-label={`Move item ${n} up`} disabled={index === 0} onClick={() => move(index, -1)} className={iconButton}>{Icon.up}</button>
                    <button type="button" aria-label={`Move item ${n} down`} disabled={index === value.length - 1} onClick={() => move(index, 1)} className={iconButton}>{Icon.down}</button>
                    <button type="button" aria-label={`Remove item ${n}`} onClick={() => onChange(value.filter((i) => i.key !== item.key))} className={iconButton}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className={`text-xs ${over ? 'font-medium text-warning' : 'text-ink-2'}`}>{`Total ${planned} of ${minutes} minutes`}</p>
        </>
      ) : null}
      <div className="flex gap-2">
        <input aria-label="New agenda item" dir="auto" value={title} onChange={(e) => { setTitle(e.target.value); setProblem(null); }} onKeyDown={onEnter} placeholder="Add a topic…" className={`${fieldClass(!!problem)} min-w-0 flex-1`} />
        <button type="button" onClick={add} className="min-h-[44px] flex-none rounded-xl border border-line px-4 text-sm font-semibold text-ink hover:bg-ground">
          Add item
        </button>
      </div>
      {problem ? <p role="alert" className="text-xs font-medium text-danger">{problem}</p> : null}
    </fieldset>
  );
}
