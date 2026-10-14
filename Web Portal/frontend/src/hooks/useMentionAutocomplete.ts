import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { applyMention, detectMention, suggestMentions, type MentionPerson } from '../lib/mentions';

export interface MentionAutocomplete {
  /** Spread onto the textarea, next to its own `value` and `ref`. */
  inputProps: {
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
    onBlur: () => void;
    'aria-autocomplete': 'list';
    'aria-controls': string | undefined;
    'aria-activedescendant': string | undefined;
  };
  open: boolean;
  /** What has been typed after the '@' (null when the caret is not in a mention). */
  query: string | null;
  matches: MentionPerson[];
  active: number;
  listId: string;
  optionId: (index: number) => string;
  setActive: (index: number) => void;
  pick: (person: MentionPerson) => void;
  close: () => void;
}

/**
 * @mention suggestions for a textarea: typing "@" plus part of a name lists the matching people;
 * ↑/↓ move, Enter or Tab puts the chosen @username in, Escape closes the list.
 *
 * While the list is open those keys are taken by a listener on the textarea itself and stopped
 * there, so the textarea's own onKeyDown (Enter sends a chat message) and an enclosing dialog
 * (Escape closes the task drawer) never see them.
 */
export function useMentionAutocomplete({
  people,
  value,
  onChange,
  inputRef,
}: {
  people: MentionPerson[];
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}): MentionAutocomplete {
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const matches = mention ? suggestMentions(people, mention.query) : [];
  const open = matches.length > 0;
  const active = Math.min(activeIndex, Math.max(0, matches.length - 1));
  const optionId = (index: number) => `${listId}-option-${index}`;

  /** Re-read the mention under the caret (after typing, clicking or moving the caret). */
  function sync(el: HTMLTextAreaElement) {
    const next = detectMention(el.value, el.selectionStart ?? el.value.length);
    if (next?.start === mention?.start && next?.query === mention?.query) return;
    setMention(next);
    setActiveIndex(0);
  }

  // Where the caret goes once the text with the picked name has rendered.
  const pendingCaret = useRef<number | null>(null);
  function pick(person: MentionPerson) {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const { text, caret } = applyMention(value, mention.start, person.username, end);
    pendingCaret.current = caret;
    onChange(text);
    setMention(null);
  }
  // Right after that render (not a frame later, when more may have been typed): setting the value
  // moved the caret to the end, so put it back just after the inserted name.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = inputRef.current;
    if (caret === null || !el) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  });

  const close = () => setMention(null);

  // The latest key handler, for the listener below (attached once per textarea element).
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e) => {
    if (!open || e.isComposing) return;
    if (e.key === 'ArrowDown') setActiveIndex((active + 1) % matches.length);
    else if (e.key === 'ArrowUp') setActiveIndex((active - 1 + matches.length) % matches.length);
    else if (e.key === 'Enter' || e.key === 'Tab') pick(matches[active]!);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  return {
    inputProps: {
      onChange: (e) => {
        onChange(e.target.value);
        sync(e.target);
      },
      onSelect: (e) => sync(e.currentTarget),
      onBlur: close,
      'aria-autocomplete': 'list',
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? optionId(active) : undefined,
    },
    open,
    // Nothing to report while there is no one to match against (still loading, or the list failed).
    query: people.length > 0 ? (mention?.query ?? null) : null,
    matches,
    active,
    listId,
    optionId,
    setActive: setActiveIndex,
    pick,
    close,
  };
}
