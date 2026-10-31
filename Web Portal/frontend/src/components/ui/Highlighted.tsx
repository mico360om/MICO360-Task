import { Fragment } from 'react';
import { highlightParts, type HighlightRange } from '../../lib/search-highlight';

/**
 * A search result's text with the words found marked (the server says where: `ranges`). Drawn as
 * text — never as markup — and without padding inside a word, so a part of a word ("scaff" in
 * scaffold) and joined Arabic letters still read as one word.
 */
export function Highlighted({ text, ranges }: { text: string; ranges?: readonly HighlightRange[] | null }) {
  return (
    <>
      {highlightParts(text, ranges).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-warning-soft font-semibold text-ink">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
