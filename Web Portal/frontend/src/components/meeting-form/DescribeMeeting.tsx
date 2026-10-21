import { useId, useState } from 'react';
import type { AiMeetingDraft } from '../../api/ai';
import type { RecurrenceRule } from '../../lib/recurrence';
import { formatMeetingRange, fromLocalInputValue } from '../../lib/meetingFormat';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { Button } from '../ui/Button';
import { aiMessage } from './ai-message';
import { personKey, type MeetingPerson } from './PeopleField';

/** The meeting form's values a sentence can fill in (times as the form's company-time inputs). */
export interface DescribedMeetingFields {
  title: string;
  description: string;
  /** "YYYY-MM-DDTHH:MM", company time. */
  start: string;
  end: string;
  rule: RecurrenceRule | null;
  projectId: string;
  location: string;
  onlineLink: string;
}

/** What "Use selected details" hands the form: fields, a length, and people and agenda points to add. */
export type DescribedMeetingPatch = Partial<Omit<DescribedMeetingFields, 'end'>> & { minutes?: number; people?: MeetingPerson[]; agenda?: string[] };

type Field = 'title' | 'description' | 'start' | 'minutes' | 'rule' | 'projectId' | 'location' | 'onlineLink';
type Suggestion =
  | { kind: 'field'; key: string; field: Field; label: string; shown: string; value: unknown; replaces: string | null; checked: boolean }
  | { kind: 'person'; key: string; label: 'Person' | 'Guest'; shown: string; person: MeetingPerson; checked: boolean }
  | { kind: 'choice'; key: string; said: string; options: Array<{ id: string; name: string }>; chosen: string | null }
  | { kind: 'agenda'; key: string; shown: string; checked: boolean };

const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Minutes between two of the form's local times, or null. */
const lengthOf = (start: string, end: string) => {
  const a = Date.parse(`${start}:00Z`);
  const b = Date.parse(`${end}:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 60_000) : null;
};

/**
 * "Describe the meeting": the assistant reads a sentence and suggests the title, day and time,
 * length, repeat, project, place, link and description — and in a new meeting the people, guests and
 * agenda points. Nothing changes until you choose; a suggestion that would replace something you set
 * yourself starts unticked, and a name more than one person goes by asks which one.
 */
export function DescribeMeeting({
  onParse,
  current,
  initial,
  onApply,
  withPeopleAndAgenda,
  projects,
  people,
  repeatText,
}: {
  onParse: (text: string) => Promise<AiMeetingDraft>;
  current: DescribedMeetingFields;
  /** The form as it opened: what differs from it is the person's own. */
  initial: DescribedMeetingFields;
  onApply: (patch: DescribedMeetingPatch) => void;
  /** A new meeting: people, guests and agenda points are offered too. */
  withPeopleAndAgenda: boolean;
  /** The projects the meeting may go to (a suggested project outside them is left out). */
  projects: Array<{ id: string; name: string; code: string; number?: string | null }>;
  /** Already invited: not offered again. */
  people: MeetingPerson[];
  repeatText: (rule: RecurrenceRule, startIso: string | null) => string;
}) {
  const id = useId();
  const timeZone = useCompanyTimeZone();
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [found, setFound] = useState<Suggestion[] | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);

  const whenText = (local: string) => formatMeetingRange(fromLocalInputValue(local, timeZone) ?? '', null, timeZone);

  function suggestionsFrom(d: AiMeetingDraft): Suggestion[] {
    const out: Suggestion[] = [];
    const field = (f: Field, label: string, shown: string, value: unknown, replaces: string | null, mine: boolean) =>
      out.push({ kind: 'field', key: f, field: f, label, shown, value, replaces, checked: !mine });
    const title = d.title?.trim().slice(0, 191);
    if (title && title !== current.title.trim()) field('title', 'Title', title, title, current.title.trim() ? `“${current.title.trim()}”` : null, current.title.trim() !== '' && current.title !== initial.title);
    if (d.date || d.startTime) {
      const start = `${d.date ?? current.start.slice(0, 10)}T${d.startTime ?? current.start.slice(11, 16)}`;
      if (start !== current.start) field('start', 'When', whenText(start), start, whenText(current.start), current.start !== initial.start);
    }
    const length = lengthOf(current.start, current.end);
    if (d.minutes && d.minutes !== length) field('minutes', 'Length', `${d.minutes} minutes`, d.minutes, length ? `${length} minutes` : null, current.end !== '' && current.end !== initial.end);
    if (d.recurrence && !sameRule(d.recurrence, current.rule)) {
      field('rule', 'Repeat', repeatText(d.recurrence, fromLocalInputValue(current.start, timeZone)), d.recurrence, current.rule ? repeatText(current.rule, fromLocalInputValue(current.start, timeZone)) : null, current.rule !== null && !sameRule(current.rule, initial.rule));
    }
    const project = d.project ? projects.find((p) => p.id === d.project!.id) : undefined;
    if (project && project.id !== current.projectId) {
      const now = projects.find((p) => p.id === current.projectId);
      field('projectId', 'Project', [project.name, project.code, project.number].filter(Boolean).join(' · '), project.id, now ? now.name : null, current.projectId !== '' && current.projectId !== initial.projectId);
    }
    const location = d.location?.trim();
    if (location && location !== current.location.trim()) field('location', 'Location', location, location, current.location.trim() ? `“${current.location.trim()}”` : null, current.location.trim() !== '' && current.location !== initial.location);
    const link = d.onlineLink?.trim();
    if (link && link !== current.onlineLink.trim()) field('onlineLink', 'Online link', link, link, current.onlineLink.trim() || null, current.onlineLink.trim() !== '' && current.onlineLink !== initial.onlineLink);
    const description = d.description?.trim();
    if (description && description !== current.description.trim()) {
      field('description', 'Description', clip(description, 200), description, current.description.trim() ? `“${clip(current.description.trim(), 60)}”` : null, current.description.trim() !== '' && current.description !== initial.description);
    }
    if (withPeopleAndAgenda) {
      const have = new Set(people.map(personKey));
      for (const p of d.people.found) {
        const person: MeetingPerson = { kind: 'user', id: p.id, name: p.name };
        if (!have.has(personKey(person))) out.push({ kind: 'person', key: personKey(person), label: 'Person', shown: p.name, person, checked: true });
      }
      d.people.choices.forEach((c, i) => out.push({ kind: 'choice', key: `choice-${i}`, said: c.said, options: c.options, chosen: null }));
      for (const g of d.guests) {
        const person: MeetingPerson = { kind: 'guest', email: g.email, name: g.name };
        if (!have.has(personKey(person))) out.push({ kind: 'person', key: personKey(person), label: 'Guest', shown: `${g.name} (${g.email})`, person, checked: true });
      }
      d.agenda.forEach((a, i) => out.push({ kind: 'agenda', key: `agenda-${i}`, shown: a, checked: true }));
    }
    return out;
  }

  async function read() {
    const t = text.trim();
    if (!t || reading) return;
    setReading(true);
    setProblem(null);
    setFound(null);
    try {
      const d = await onParse(t);
      setFound(suggestionsFrom(d));
      setNotFound(withPeopleAndAgenda ? d.people.notFound : []);
    } catch (err) {
      setProblem(aiMessage(err, 'Couldn’t read that description. Try rephrasing it, or fill in the details yourself.'));
    } finally {
      setReading(false);
    }
  }

  const isOn = (s: Suggestion) => (s.kind === 'choice' ? s.chosen !== null : s.checked);
  function apply() {
    const patch: DescribedMeetingPatch = {};
    const add: MeetingPerson[] = [];
    const agenda: string[] = [];
    for (const s of found ?? []) {
      if (!isOn(s)) continue;
      if (s.kind === 'field') (patch as Record<string, unknown>)[s.field] = s.value;
      else if (s.kind === 'person') add.push(s.person);
      else if (s.kind === 'choice') {
        const o = s.options.find((x) => x.id === s.chosen)!;
        add.push({ kind: 'user', id: o.id, name: o.name });
      } else agenda.push(s.shown);
    }
    if (add.length) patch.people = add.filter((p, i) => add.findIndex((q) => personKey(q) === personKey(p)) === i);
    if (agenda.length) patch.agenda = agenda;
    onApply(patch);
    setFound(null);
    setNotFound([]);
  }
  const update = (key: string, change: (s: Suggestion) => Suggestion) => setFound((f) => f!.map((s) => (s.key === key ? change(s) : s)));

  return (
    <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] p-3.5 sm:p-4">
      <label htmlFor={`${id}-text`} className="flex items-center gap-1.5 text-sm font-semibold text-brand">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2zM18.5 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.4z" /></svg>
        Describe the meeting
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-xs text-ink-2">
        The assistant suggests the title, time, length, repeat, project and place{withPeopleAndAgenda ? ', people and agenda' : ''} — you choose what to use.
      </p>
      <textarea
        id={`${id}-text`}
        dir="auto"
        rows={2}
        value={text}
        aria-describedby={`${id}-hint`}
        onChange={(e) => { setText(e.target.value); if (problem) setProblem(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void read(); } }}
        placeholder="e.g. “Weekly site review with Sara and Omar every Monday at 10 for 90 minutes, PUMP project”"
        className="mt-2 block min-h-[4.5rem] w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-2 [@media(pointer:coarse)]:hidden">Ctrl + Enter also works.</span>
        <Button type="button" variant="secondary" size="sm" loading={reading} disabled={!text.trim()} onClick={() => void read()} className="ms-auto min-h-[36px]">
          {reading ? 'Reading…' : 'Fill meeting details'}
        </Button>
      </div>
      <div aria-live="polite">
        {problem ? <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
        {found && found.length === 0 ? <p className="mt-2 text-sm text-ink-2">Nothing new to fill in from that description.</p> : null}
        {found && found.length > 0 ? (
          <div role="group" aria-label="Suggested details" className="mt-3 rounded-xl border border-line bg-surface p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Found in your description</p>
            <ul className="flex flex-col gap-1.5">
              {found.map((s) =>
                s.kind === 'choice' ? (
                  <li key={s.key} className="px-1.5 py-1">
                    <div role="radiogroup" aria-label={`Which ${s.said}?`} className="text-sm">
                      <p className="font-semibold text-ink">Which <bdi>{s.said}</bdi>?</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {[...s.options, { id: '', name: 'Neither' }].map((o) => (
                          <label key={o.id || 'none'} className="flex min-h-8 cursor-pointer items-center gap-1.5 text-ink">
                            <input
                              type="radio"
                              name={`${id}-${s.key}`}
                              checked={(s.chosen ?? '') === o.id}
                              onChange={() => update(s.key, (x) => ({ ...x, chosen: o.id || null }) as Suggestion)}
                              className="h-4 w-4 accent-brand"
                            />
                            <bdi>{o.name}</bdi>
                          </label>
                        ))}
                      </div>
                    </div>
                  </li>
                ) : (
                  <li key={s.key}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-ground">
                      <input
                        type="checkbox"
                        checked={s.checked}
                        aria-label={`${s.kind === 'agenda' ? 'Agenda' : s.label}: ${s.shown}`}
                        onChange={() => update(s.key, (x) => ({ ...x, checked: !(x as { checked: boolean }).checked }) as Suggestion)}
                        className="mt-0.5 h-4 w-4 flex-none accent-brand"
                      />
                      <span className="min-w-0 text-sm">
                        <span className="font-semibold text-ink">{s.kind === 'agenda' ? 'Agenda' : s.label}:</span> <bdi className="break-words text-ink">{s.shown}</bdi>
                        {s.kind === 'field' && s.replaces ? <span className="block text-xs text-ink-2">Replaces {s.replaces}</span> : null}
                      </span>
                    </label>
                  </li>
                ),
              )}
            </ul>
            {notFound.length ? <p className="mt-2 px-1.5 text-xs text-ink-2">Not found: {notFound.join(', ')} — add them by hand under People, or as a guest.</p> : null}
            <div className="mt-2.5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setFound(null); setNotFound([]); }} className="min-h-[36px] rounded-lg px-3 text-sm font-semibold text-ink-2 hover:bg-ground">Dismiss</button>
              <Button type="button" size="sm" onClick={apply} disabled={!found.some(isOn)} className="min-h-[36px]">Use selected details</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
