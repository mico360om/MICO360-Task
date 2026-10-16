import { useId, useState } from 'react';
import type { Priority } from '../../api/tasks';
import type { AiTaskDraft } from '../../api/ai';
import type { RecurrenceRule } from '../../lib/recurrence';
import { ApiError } from '../../lib/api-client';
import { formatDueDay } from '../../lib/due-display';
import { priorityLabel } from '../priority-option';
import { Button } from '../ui/Button';

/** The task details a description can fill in. */
export interface DescribedFields {
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  rule: RecurrenceRule | null;
  projectId: string;
}

/** A project the task can go to, as a suggestion shows it. */
export interface DescribeProject {
  id: string;
  name: string;
  code: string;
  number?: string | null;
}

type Key = keyof DescribedFields;
interface Suggestion {
  key: Key;
  label: string;
  /** How the suggested value reads. */
  shown: string;
  value: DescribedFields[Key];
  /** What it would replace, when something is already there. */
  replaces: string | null;
  /** Ticked to start with: only when it fills something you haven't set yourself. */
  checked: boolean;
}

const dayText = (key: string) => formatDueDay(key, 'UTC', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const projectText = (p: DescribeProject) => [p.name, p.code, p.number].filter(Boolean).join(' · ');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * "Describe it in plain English": the assistant reads a sentence and suggests a title, a
 * description, a due date, a priority, a repeat and the project. Nothing changes until you choose:
 * suggestions that would replace something you set yourself start unticked. A project is only
 * offered when the task's project can still be chosen, and only one of `projects`.
 */
export function DescribeTask({ onParse, current, initial, onApply, projects, projectChosen = false, repeatText }: {
  onParse: (text: string) => Promise<AiTaskDraft>;
  /** The form's values now, and when it opened (what isn't yours, e.g. a day picked on the calendar). */
  current: DescribedFields;
  initial: DescribedFields;
  onApply: (patch: Partial<DescribedFields>) => void;
  /** The projects the task may go to; omitted when its project is fixed (a board, editing). */
  projects?: DescribeProject[];
  /** The project was picked by hand (even if it is the one the form started with): it is yours. */
  projectChosen?: boolean;
  /** How a repeat reads ("Repeats every week on Mon"), given the due date it would start from. */
  repeatText: (rule: RecurrenceRule, dueDate: string) => string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [found, setFound] = useState<Suggestion[] | null>(null);

  function suggestionsFrom(draft: AiTaskDraft): Suggestion[] {
    const out: Suggestion[] = [];
    const title = draft.title?.trim().slice(0, 191);
    if (title && title !== current.title.trim()) {
      const mine = current.title.trim() !== '';
      out.push({ key: 'title', label: 'Title', shown: title, value: title, replaces: mine ? `“${current.title.trim()}”` : null, checked: !mine });
    }
    const description = draft.description?.trim();
    if (description && description !== current.description.trim()) {
      const mine = current.description.trim() !== '' && current.description !== initial.description;
      out.push({ key: 'description', label: 'Description', shown: clip(description, 200), value: description, replaces: current.description.trim() ? `“${clip(current.description.trim(), 60)}”` : null, checked: !mine });
    }
    if (draft.dueDate && draft.dueDate !== current.dueDate) {
      const mine = current.dueDate !== '' && current.dueDate !== initial.dueDate;
      out.push({ key: 'dueDate', label: 'Due date', shown: dayText(draft.dueDate), value: draft.dueDate, replaces: current.dueDate ? dayText(current.dueDate) : null, checked: !mine });
    }
    if (draft.recurrence && !sameRule(draft.recurrence, current.rule)) {
      const startsOn = draft.dueDate ?? current.dueDate;
      const mine = current.rule !== null && !sameRule(current.rule, initial.rule);
      out.push({
        key: 'rule',
        label: 'Repeat',
        shown: repeatText(draft.recurrence, startsOn),
        value: draft.recurrence,
        replaces: current.rule ? repeatText(current.rule, current.dueDate) : null,
        checked: !mine,
      });
    }
    if (draft.priority && draft.priority !== current.priority) {
      const mine = current.priority !== initial.priority;
      out.push({ key: 'priority', label: 'Priority', shown: priorityLabel(draft.priority), value: draft.priority, replaces: priorityLabel(current.priority), checked: !mine });
    }
    const project = draft.project ? projects?.find((p) => p.id === draft.project!.id) : undefined;
    if (project && project.id !== current.projectId) {
      const mine = projectChosen || (current.projectId !== '' && current.projectId !== initial.projectId);
      const now = projects?.find((p) => p.id === current.projectId);
      const shown = projectText({ ...project, number: project.number ?? draft.project!.number });
      out.push({ key: 'projectId', label: 'Project', shown, value: project.id, replaces: now ? now.name : null, checked: !mine });
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
      setFound(suggestionsFrom(await onParse(t)));
    } catch (err) {
      setProblem(err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : 'Couldn’t read that description. Try rephrasing it, or fill in the details yourself.');
    } finally {
      setReading(false);
    }
  }

  function apply() {
    const patch: Partial<DescribedFields> = {};
    for (const s of found ?? []) if (s.checked) (patch as Record<Key, unknown>)[s.key] = s.value;
    onApply(patch);
    setFound(null);
  }

  return (
    <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] p-3.5 sm:p-4">
      <label id={`${id}-label`} htmlFor={`${id}-text`} className="flex items-center gap-1.5 text-sm font-semibold text-brand">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2zM18.5 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.4z" /></svg>
        Describe it in plain English
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-xs text-ink-2">
        The assistant suggests a title, description, due date, repeat, priority{projects ? ' and project' : ''} — you choose what to use.
      </p>
      <textarea
        id={`${id}-text`}
        dir="auto"
        rows={2}
        value={text}
        aria-describedby={`${id}-hint`}
        onChange={(e) => { setText(e.target.value); if (problem) setProblem(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void read(); } }}
        placeholder="e.g. “Send the RIG1 site report to Omar every Monday, with the inspection photos”"
        className="mt-2 block min-h-[4.5rem] w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-2 [@media(pointer:coarse)]:hidden">Ctrl + Enter also works.</span>
        <Button type="button" variant="secondary" size="sm" loading={reading} disabled={!text.trim()} onClick={() => void read()} className="ms-auto min-h-[36px]">
          {reading ? 'Reading…' : 'Fill task details'}
        </Button>
      </div>
      <div aria-live="polite">
        {problem ? <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
        {found && found.length === 0 ? <p className="mt-2 text-sm text-ink-2">Nothing new to fill in from that description.</p> : null}
        {found && found.length > 0 ? (
          <div role="group" aria-label="Suggested details" className="mt-3 rounded-xl border border-line bg-surface p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Found in your description</p>
            <ul className="flex flex-col gap-1.5">
              {found.map((s, i) => (
                <li key={s.key}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-ground">
                    <input
                      type="checkbox"
                      checked={s.checked}
                      aria-label={`${s.label}: ${s.shown}`}
                      onChange={() => setFound((f) => f!.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))}
                      className="mt-0.5 h-4 w-4 flex-none accent-brand"
                    />
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-ink">{s.label}:</span> <bdi className="break-words text-ink">{s.shown}</bdi>
                      {s.replaces ? <span className="block text-xs text-ink-2">Replaces {s.replaces}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setFound(null)} className="min-h-[36px] rounded-lg px-3 text-sm font-semibold text-ink-2 hover:bg-ground">Dismiss</button>
              <Button type="button" size="sm" onClick={apply} disabled={!found.some((s) => s.checked)} className="min-h-[36px]">Use selected details</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
