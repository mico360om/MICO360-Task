import { useRef, useState, type FormEvent } from 'react';
import type { Priority } from '../api/tasks';
import { Button } from './ui/Button';
import { FieldLabel, FieldError, fieldClass } from './ui/Field';

export interface QuickAddValues {
  title: string;
  priority: Priority;
  description: string;
  assigneeIds: string[];
  /** ISO date (YYYY-MM-DD); present only when a due date was set. */
  dueDate?: string;
}

export interface AssigneeOption {
  id: string;
  label: string;
}

export interface QuickAddParseResult {
  title: string;
  dueDate: string | null;
  priority: Priority | null;
}

export interface QuickAddTaskFormProps {
  onSubmit: (values: QuickAddValues) => void;
  submitting?: boolean;
  /** Optional people who can be assigned (project members). Omit to hide the field. */
  assignees?: AssigneeOption[];
  /** Optional AI parser — turns a plain-English note into a task draft to prefill the form. */
  onParse?: (text: string) => Promise<QuickAddParseResult>;
}

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export function QuickAddTaskForm({ onSubmit, submitting = false, assignees, onParse }: QuickAddTaskFormProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [nlText, setNlText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  function toggleAssignee(id: string) {
    setAssigneeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function handleParse() {
    if (!onParse || parsing) return;
    const text = nlText.trim();
    if (!text) return;
    setParsing(true);
    setParseError(null);
    try {
      const draft = await onParse(text);
      setTitle(draft.title);
      if (draft.priority) setPriority(draft.priority);
      if (draft.dueDate) setDueDate(draft.dueDate);
      setTitleError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read that — try rephrasing.');
    } finally {
      setParsing(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError('A task title is required.');
      titleRef.current?.focus();
      return;
    }
    onSubmit({ title: title.trim(), priority, description: description.trim(), assigneeIds, ...(dueDate ? { dueDate } : {}) });
  }

  const field = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {onParse ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-brand/20 bg-brand/5 p-3">
          <label htmlFor="qat-nl" className="flex items-center gap-1.5 text-sm font-medium text-brand">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2zM18.5 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.4z" /></svg>
            Describe it in plain English
          </label>
          <div className="flex items-start gap-2">
            <input
              id="qat-nl"
              value={nlText}
              onChange={(e) => { setNlText(e.target.value); if (parseError) setParseError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleParse(); } }}
              placeholder="Describe a task, e.g. “review the report by Friday”"
              className={`${field} min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={() => void handleParse()}
              disabled={parsing || nlText.trim() === ''}
              className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50"
            >
              {parsing ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : null}
              {parsing ? 'Reading…' : 'Parse'}
            </button>
          </div>
          {parseError ? <p className="text-xs text-danger">{parseError}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="qat-title" required>
          Task title
        </FieldLabel>
        <input
          id="qat-title"
          ref={titleRef}
          value={title}
          required
          aria-required="true"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? 'qat-title-error' : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError) setTitleError(null);
          }}
          className={fieldClass(!!titleError)}
        />
        <FieldError id="qat-title-error">{titleError}</FieldError>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="qat-description" className="text-sm font-medium text-ink">
          Description
        </label>
        <textarea
          id="qat-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Add more detail (optional)"
          className={`${field} resize-y`}
        />
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="qat-priority" className="text-sm font-medium text-ink">
            Priority
          </label>
          <select id="qat-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={field}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="qat-due" className="text-sm font-medium text-ink">
            Due date
          </label>
          <input id="qat-due" type="date" aria-label="Due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
        </div>
      </div>
      {assignees && assignees.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Assign to</span>
          <div role="group" aria-label="Assign to" className="flex flex-wrap gap-2">
            {assignees.map((a) => {
              const checked = assigneeIds.includes(a.id);
              return (
                <label
                  key={a.id}
                  className={`flex cursor-pointer select-none items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    checked ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleAssignee(a.id)} />
                  <span
                    aria-hidden="true"
                    className={`grid h-4 w-4 place-items-center rounded-[4px] border text-[10px] ${
                      checked ? 'border-brand bg-brand text-white' : 'border-line'
                    }`}
                  >
                    {checked ? '✓' : ''}
                  </span>
                  {a.label}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      <Button type="submit" loading={submitting}>
        {submitting ? 'Adding…' : 'Add task'}
      </Button>
    </form>
  );
}
