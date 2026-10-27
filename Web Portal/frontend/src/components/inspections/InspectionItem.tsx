import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnswerView, FollowUpView } from '../../api/inspections';
import { effectiveResult, INSPECTION_LIMITS, limitsText, parseReading, readingText, type FormItem, type ItemResult } from '../../lib/inspection-rules';
import { ResultChip } from './inspection-ui';

export interface ItemAnswer {
  result: ItemResult | null;
  reading: string | null;
  note: string | null;
}

export interface InspectionItemProps {
  item: FormItem;
  /** Its number through the whole inspection (as the report numbers it). */
  number: number;
  answer: AnswerView | undefined;
  readOnly: boolean;
  onAnswer: (value: ItemAnswer) => void;
  /** Its follow-up task: made, being made, or waiting on this phone (queued). */
  followUp?: (Pick<FollowUpView, 'task' | 'pending' | 'moved'> & { queued: boolean }) | null;
  canMakeFollowUp?: boolean;
  onMakeFollowUp?: () => void;
}

/** A note or reading being typed is saved this long after the last key (and at once when the box is left). */
export const DRAFT_DELAY_MS = 700;

const CHOICES: Array<{ value: ItemResult; label: string; on: string }> = [
  { value: 'PASS', label: 'Pass', on: 'border-success bg-success-soft text-success' },
  { value: 'FAIL', label: 'Fail', on: 'border-danger bg-danger-soft text-danger' },
  { value: 'NA', label: 'N/A', on: 'border-ink-3 bg-ground text-ink' },
];

/**
 * One checklist item: Pass / Fail / N/A (a radio group), or a reading with its unit and limits whose
 * result is worked out as it is typed — outside the limits it fails, in words, not by colour alone.
 * Either may carry a note. A failed item offers a follow-up task (or links the one made).
 */
export function InspectionItem({ item, number, answer, readOnly, onAnswer, followUp, canMakeFollowUp, onMakeFollowUp }: InspectionItemProps) {
  const ids = { label: useId(), help: useId(), reading: useId(), readingHint: useId(), readingError: useId(), note: useId() };
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(answer?.note ?? '');
  const [readingDraft, setReadingDraft] = useState(answer?.reading ?? '');
  const [readingError, setReadingError] = useState<string | null>(null);
  const editingReading = useRef(false);
  const editingNote = useRef(false);
  // The newest answer and callback, for a save that runs a moment after typing stops.
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const drafts = useRef<Record<'note' | 'reading', { timer: ReturnType<typeof setTimeout>; run: () => void } | undefined>>({ note: undefined, reading: undefined });
  const later = (which: 'note' | 'reading', run: () => void) => {
    const was = drafts.current[which];
    if (was) clearTimeout(was.timer);
    drafts.current[which] = {
      run,
      timer: setTimeout(() => {
        drafts.current[which] = undefined;
        // Signed or finished meanwhile: nothing more to save.
        if (!readOnlyRef.current) run();
      }, DRAFT_DELAY_MS),
    };
  };
  const cancel = (which: 'note' | 'reading') => {
    const was = drafts.current[which];
    if (was) clearTimeout(was.timer);
    drafts.current[which] = undefined;
  };
  // Leaving the page (or the item going) saves what was being typed.
  useEffect(
    () => () => {
      for (const which of ['note', 'reading'] as const) {
        const was = drafts.current[which];
        if (!was) continue;
        clearTimeout(was.timer);
        drafts.current[which] = undefined;
        if (!readOnlyRef.current) was.run();
      }
    },
    [],
  );

  // A newer answer (sent from elsewhere, or sent back by the server) shows unless it is being typed.
  useEffect(() => {
    if (!editingReading.current) setReadingDraft(answer?.reading ?? '');
  }, [answer?.reading]);
  useEffect(() => {
    if (!editingNote.current) setNoteText(answer?.note ?? '');
  }, [answer?.note]);

  const note = answer?.note ?? null;
  const save = (next: Partial<ItemAnswer>) => {
    const a = answerRef.current;
    onAnswerRef.current({ result: a?.result ?? null, reading: a?.reading ?? null, note: a?.note ?? null, ...next });
  };
  /** A note as typed so far, if it differs from the one saved. */
  const saveNoteText = (value: string) => {
    const text = value.trim();
    if ((text || null) !== (answerRef.current?.note ?? null)) save({ note: text || null });
  };
  /** A reading as typed so far, once it is a number (anything else waits for the box to be left). */
  const saveReadingText = (value: string) => {
    const v = value.trim() ? parseReading(value.trim()) : null;
    if (v !== null && v !== answerRef.current?.reading) save({ reading: v, result: null });
  };

  // A reading's result as it stands while typed (the server works it out the same way).
  const typed = item.kind === 'READING' && readingDraft.trim() ? parseReading(readingDraft) : null;
  const liveResult: ItemResult | null =
    item.kind === 'READING' ? (readingDraft.trim() ? (typed !== null ? effectiveResult(item, { result: null, reading: typed }) : null) : effectiveResult(item, answer ?? null)) : effectiveResult(item, answer ?? null);
  const limits = item.kind === 'READING' ? limitsText(item) : '';
  const failed = liveResult === 'FAIL';

  const commitReading = () => {
    cancel('reading');
    editingReading.current = false;
    const text = readingDraft.trim();
    if (item.kind !== 'READING') return;
    if (!text) {
      setReadingError(null);
      if (answer?.reading) save({ reading: null, result: null });
      return;
    }
    const value = parseReading(text);
    if (value === null) {
      setReadingError('Enter the reading as a number, like 12.5');
      return;
    }
    setReadingError(null);
    if (value !== answer?.reading) save({ reading: value, result: null });
  };

  const commitNote = () => {
    cancel('note');
    editingNote.current = false;
    saveNoteText(noteText);
  };

  return (
    <li id={`item-${item.id}`} className="scroll-mt-28 py-3 first:pt-0 last:pb-0" aria-labelledby={ids.label}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-6 flex-none text-end font-mono text-xs text-ink-3" aria-hidden="true">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p id={ids.label} dir="auto" className="min-w-0 break-words text-sm font-semibold text-ink">
              {item.label}
            </p>
            {readOnly || item.kind === 'READING' ? <ResultChip result={liveResult} /> : null}
          </div>
          {item.help ? (
            <p id={ids.help} dir="auto" className="mt-0.5 text-xs text-ink-2">
              {item.help}
            </p>
          ) : null}

          {item.kind === 'CHECK' && !readOnly ? (
            <div role="radiogroup" aria-labelledby={ids.label} aria-describedby={item.help ? ids.help : undefined} className="mt-2 grid grid-cols-3 gap-1.5 sm:inline-grid sm:w-80">
              {CHOICES.map((c) => {
                const on = answer?.result === c.value;
                return (
                  <label
                    key={c.value}
                    className={`flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-lg border text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-brand/40 sm:min-h-9 ${on ? c.on : 'border-line text-ink-2 hover:bg-ground'}`}
                  >
                    <input type="radio" name={`result-${item.id}`} value={c.value} checked={on} onChange={() => save({ result: c.value })} className="sr-only" />
                    {on ? <span aria-hidden="true">{c.value === 'PASS' ? '✓' : c.value === 'FAIL' ? '✕' : '–'}</span> : null}
                    {c.label}
                  </label>
                );
              })}
            </div>
          ) : null}

          {item.kind === 'READING' ? (
            <div className="mt-2">
              {limits ? <p className="text-xs text-ink-2">Allowed {limits}</p> : null}
              {readOnly ? (
                <p className="mt-1 text-sm text-ink">{answer?.reading ? readingText(item, answer.reading) : answer?.result === 'NA' ? 'Not taken (N/A)' : answer?.result === 'FAIL' ? 'Couldn’t be taken (failed)' : '—'}</p>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor={ids.reading} className="sr-only">
                      {`${item.label}, reading${item.unit ? ` in ${item.unit}` : ''}`}
                    </label>
                    <input
                      id={ids.reading}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      dir="ltr"
                      value={readingDraft}
                      maxLength={INSPECTION_LIMITS.readingMax}
                      onChange={(e) => {
                        editingReading.current = true;
                        const value = e.target.value;
                        setReadingDraft(value);
                        if (readingError) setReadingError(null);
                        later('reading', () => saveReadingText(value));
                      }}
                      onBlur={commitReading}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitReading();
                        }
                      }}
                      aria-invalid={readingError ? true : undefined}
                      aria-describedby={[readingError ? ids.readingError : null, failed ? ids.readingHint : null].filter(Boolean).join(' ') || undefined}
                      placeholder="Reading"
                      className="h-11 w-32 rounded-lg border border-line bg-surface px-3 text-base text-ink outline-none focus:border-brand sm:h-9 sm:text-sm"
                    />
                    {item.unit ? <span className="text-sm text-ink-2">{item.unit}</span> : null}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        cancel('reading');
                        setReadingDraft('');
                        setReadingError(null);
                        save({ reading: null, result: 'NA' });
                      }}
                      aria-label={`N/A: ${item.label}`}
                      aria-pressed={!answer?.reading && answer?.result === 'NA'}
                      className={`min-h-11 rounded-lg border px-2.5 text-xs font-semibold sm:min-h-9 ${!answer?.reading && answer?.result === 'NA' ? 'border-ink-3 bg-ground text-ink' : 'border-line text-ink-2 hover:bg-ground'}`}
                    >
                      N/A
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        cancel('reading');
                        setReadingDraft('');
                        setReadingError(null);
                        save({ reading: null, result: 'FAIL' });
                      }}
                      aria-label={`Couldn’t take it (fail): ${item.label}`}
                      aria-pressed={!answer?.reading && answer?.result === 'FAIL'}
                      className={`min-h-11 rounded-lg border px-2.5 text-xs font-semibold sm:min-h-9 ${!answer?.reading && answer?.result === 'FAIL' ? 'border-danger bg-danger-soft text-danger' : 'border-line text-ink-2 hover:bg-ground'}`}
                    >
                      Couldn’t take it
                    </button>
                  </div>
                </div>
              )}
              {readingError ? (
                <p id={ids.readingError} role="alert" className="mt-1 text-xs font-medium text-danger">
                  {readingError}
                </p>
              ) : null}
              {failed && limits && (typed !== null || answer?.reading) ? (
                <p id={ids.readingHint} className="mt-1 text-xs font-semibold text-danger">
                  Outside the allowed {limits}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* The note: shown when there is one (or being written), else one tap away. */}
          {readOnly ? (
            note ? (
              <p dir="auto" className="mt-1.5 whitespace-pre-line rounded-lg bg-ground px-2.5 py-1.5 text-sm text-ink">
                {note}
              </p>
            ) : null
          ) : noteOpen || note ? (
            <div className="mt-2">
              <label htmlFor={ids.note} className="text-xs font-medium text-ink-2">
                <span className="sr-only">{`Note: ${item.label}`}</span>
                <span aria-hidden="true">Note</span>
              </label>
              <textarea
                id={ids.note}
                dir="auto"
                rows={2}
                maxLength={INSPECTION_LIMITS.noteMax}
                value={noteText}
                onChange={(e) => {
                  editingNote.current = true;
                  const value = e.target.value;
                  setNoteText(value);
                  later('note', () => saveNoteText(value));
                }}
                onBlur={commitNote}
                className="mt-0.5 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink outline-none focus:border-brand sm:text-sm"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} aria-label={`Add a note: ${item.label}`} className="tap mt-1.5 text-xs font-semibold text-brand hover:underline">
              + Note
            </button>
          )}

          {failed ? (
            <div className="mt-2 text-xs">
              {followUp?.task ? (
                <Link to={`?task=${encodeURIComponent(followUp.task.id)}`} className="tap inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                  Follow-up task: <span className="font-mono">{followUp.task.key}</span>
                  {followUp.task.deleted ? <span className="font-normal text-ink-3"> (deleted)</span> : followUp.task.done ? <span className="font-normal text-ink-2"> (done)</span> : null}
                </Link>
              ) : followUp?.moved ? (
                <p className="text-ink-2">Its follow-up task was moved to another project.</p>
              ) : followUp?.queued ? (
                <p className="text-ink-2">Follow-up task saved on this phone: it’s made when you’re back online.</p>
              ) : followUp?.pending ? (
                <p className="text-ink-2">Its follow-up task is being made…</p>
              ) : canMakeFollowUp && onMakeFollowUp ? (
                <button type="button" onClick={onMakeFollowUp} aria-label={`Make a follow-up task: ${item.label}`} className="tap font-semibold text-brand hover:underline">
                  Make a follow-up task
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
