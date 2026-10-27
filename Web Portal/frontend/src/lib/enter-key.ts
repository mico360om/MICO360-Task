import type { KeyboardEvent } from 'react';

/**
 * Enter in a one-line field of a long form does nothing: it must not submit (or close) the form
 * half-way through filling it in. Ctrl+Enter (⌘+Enter) still submits it, as everywhere.
 */
export function stayOnEnter(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) e.preventDefault();
}
