import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './ui/Avatar';
import { tokenizeMentions, type MentionPerson } from '../lib/mentions';
import type { MentionAutocomplete } from '../hooks/useMentionAutocomplete';

/** The part of the screen an element can show in: the viewport, cut down by any scrolling/clipping ancestors. */
function visibleArea(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
      const r = node.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
    }
  }
  return { top, bottom };
}

/**
 * The "Mention someone" suggestion list for a textarea using `useMentionAutocomplete`. Put both in
 * a `relative` wrapper. `placement="auto"` opens it below the box when it fits there, else above.
 */
export function MentionList({
  mentions,
  placement = 'auto',
  className = '',
  emptyText = (query) => `No one matches “@${query}”.`,
}: {
  mentions: MentionAutocomplete;
  placement?: 'auto' | 'above';
  /** Said when nobody matches what was typed — so an empty result never looks like a broken feature. */
  emptyText?: (query: string) => string;
  /** Extra classes for the list's box (e.g. an inset from the wrapper's edge). */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  const { open, query, matches, active, listId, optionId, setActive, pick } = mentions;
  const noMatch = !open && Boolean(query);
  const showing = open || noMatch;

  useLayoutEffect(() => {
    const list = ref.current;
    const anchor = list?.parentElement;
    if (!showing || placement !== 'auto' || !list || !anchor) return;
    const box = anchor.getBoundingClientRect();
    const area = visibleArea(anchor);
    const spaceBelow = area.bottom - box.bottom;
    setBelow(spaceBelow >= list.offsetHeight + 4 || spaceBelow >= box.top - area.top);
  }, [showing, matches.length, placement]);

  if (!showing) return null;
  const boxClass = `absolute start-0 z-20 w-72 max-w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lift ${below ? 'top-full mt-1' : 'bottom-full mb-1'} ${className}`;
  if (noMatch) {
    return (
      <div ref={ref} role="status" className={`${boxClass} px-3 py-2 text-xs text-ink-2`}>
        {emptyText(query!)}
      </div>
    );
  }
  return (
    <div ref={ref} className={boxClass}>
      <div id={`${listId}-label`} className="border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
        Mention someone
      </div>
      <ul role="listbox" id={listId} aria-labelledby={`${listId}-label`}>
        {matches.map((p, i) => (
          <li
            key={p.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus (and the caret) in the textarea
              pick(p);
            }}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? 'bg-brand/10' : 'hover:bg-ground'}`}
          >
            <span aria-hidden="true" className="flex">
              <Avatar name={p.name || p.username} size="sm" src={p.avatarUrl} />
            </span>
            <span dir="auto" className="min-w-0 flex-1 truncate text-start text-ink">{p.name || p.username}</span>
            <span dir="ltr" className="text-xs text-ink-2">@{p.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Text with @mentions of real people marked; hovering one shows who it is. */
export function MentionText({ body, people }: { body: string; people: MentionPerson[] }) {
  const byUsername = useMemo(() => new Map(people.map((p) => [p.username, p])), [people]);
  const tokens = useMemo(() => tokenizeMentions(body, people.map((p) => p.username)), [body, people]);
  return (
    <>
      {tokens.map((tok, i) => {
        const person = tok.type === 'mention' && tok.username ? byUsername.get(tok.username) : undefined;
        return person ? (
          <span key={i} title={person.name || person.username} className="rounded px-0.5 font-semibold text-brand">
            {tok.value}
          </span>
        ) : (
          tok.value
        );
      })}
    </>
  );
}
