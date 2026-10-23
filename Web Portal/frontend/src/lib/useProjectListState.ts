import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readListState, writeListState, type ProjectListState } from './project-list';

/** Typing reaches the address this long after the last key. */
const TYPING_MS = 250;
const keyOf = (s: ProjectListState) => writeListState(new URLSearchParams(), s).toString();

/**
 * The Projects list's tab, search, owner, sort and "only mine", kept here and mirrored to the
 * address so Back and shared links work. React Router 7 applies a search-params change as a
 * transition — the address catches up a moment later — so reading the state back from it would
 * drop keys typed meanwhile and pull a tab back. The page follows the address only when it changes
 * by itself (Back, Forward, a link). Each change adds a history entry, except typing: that reaches
 * the address after a pause and replaces the entry once a search has started.
 */
export function useProjectListState(): [ProjectListState, (changes: Partial<ProjectListState>, options?: { replace?: boolean }) => void] {
  const [params, setParams] = useSearchParams();
  const addressKey = keyOf(readListState(params));
  const [state, setState] = useState(() => readListState(params));
  const latest = useRef(state);
  /** Keys written to the address that it hasn't shown yet. */
  const ours = useRef<string[]>([]);
  /** What the address shows, or is about to. */
  const shown = useRef(addressKey);
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const at = ours.current.indexOf(addressKey);
    if (at >= 0) {
      ours.current.splice(0, at + 1);
      return;
    }
    if (addressKey === keyOf(latest.current)) return;
    // Changed by itself: follow it.
    clearTimeout(typing.current);
    ours.current = [];
    shown.current = addressKey;
    const next = readListState(new URLSearchParams(addressKey));
    latest.current = next;
    setState(next);
  }, [addressKey]);

  useEffect(() => () => clearTimeout(typing.current), []);

  const mirror = (next: ProjectListState, replace: boolean) => {
    const key = keyOf(next);
    if (key === shown.current) return;
    shown.current = key;
    ours.current.push(key);
    setParams((prev) => writeListState(prev, next), { replace });
  };

  /** `replace`: correct the address in place (no new history entry). */
  const change = (changes: Partial<ProjectListState>, options: { replace?: boolean } = {}) => {
    const next = { ...latest.current, ...changes };
    latest.current = next;
    setState(next);
    clearTimeout(typing.current);
    if (Object.keys(changes).every((k) => k === 'q')) {
      typing.current = setTimeout(() => mirror(latest.current, new URLSearchParams(shown.current).has('q')), TYPING_MS);
    } else {
      mirror(next, options.replace ?? false);
    }
  };

  return [state, change];
}
