import { Fragment, type ReactNode } from 'react';
import { parseRichHtml, type RichBlock, type RichRun } from '../../lib/rich-note';

/** One run: its words (line breaks kept), inside its marks, inside its link. */
function Run({ run }: { run: RichRun }) {
  const lines = run.text.split('\n');
  let node: ReactNode = lines.map((l, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {l}
    </Fragment>
  ));
  if (run.marks.includes('highlight')) node = <mark>{node}</mark>;
  if (run.marks.includes('underline')) node = <u>{node}</u>;
  if (run.marks.includes('italic')) node = <em>{node}</em>;
  if (run.marks.includes('bold')) node = <strong>{node}</strong>;
  if (run.href) {
    node = (
      <a href={run.href} target="_blank" rel="noopener noreferrer nofollow">
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

const Runs = ({ runs }: { runs: RichRun[] }) => (
  <>
    {runs.map((r, i) => (
      <Run key={i} run={r} />
    ))}
  </>
);

interface ListNode {
  ordered: boolean;
  items: Array<{ runs: RichRun[]; children: ListNode[] }>;
}

/** Blocks into paragraphs, headings and nested lists (items one level deeper sit in the item above). */
function structure(blocks: RichBlock[]): Array<{ kind: 'paragraph' | 'heading'; runs: RichRun[] } | { kind: 'list'; list: ListNode }> {
  const out: Array<{ kind: 'paragraph' | 'heading'; runs: RichRun[] } | { kind: 'list'; list: ListNode }> = [];
  const stack: ListNode[] = [];
  for (const b of blocks) {
    if (b.kind !== 'item') {
      stack.length = 0;
      out.push({ kind: b.kind, runs: b.runs });
      continue;
    }
    const level = Math.min(b.level, stack.length);
    stack.length = Math.min(stack.length, level + 1);
    if (stack.length === level + 1 && stack[level]!.ordered !== b.ordered) stack.length = level;
    if (stack.length < level + 1) {
      const list: ListNode = { ordered: b.ordered, items: [] };
      if (level === 0) out.push({ kind: 'list', list });
      else {
        const parent = stack[level - 1]!;
        if (!parent.items.length) parent.items.push({ runs: [], children: [] });
        parent.items[parent.items.length - 1]!.children.push(list);
      }
      stack.push(list);
    }
    stack[level]!.items.push({ runs: b.runs, children: [] });
  }
  return out;
}

function List({ list }: { list: ListNode }) {
  const items = list.items.map((it, i) => (
    <li key={i}>
      <p dir="auto">
        <Runs runs={it.runs} />
      </p>
      {it.children.map((c, j) => (
        <List key={j} list={c} />
      ))}
    </li>
  ));
  return list.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
}

/**
 * A formatted note as it was written: bold, italic, underline, highlight, links (opening in a new
 * tab), a heading and nested lists. Built from the note's blocks — its HTML is never inserted —
 * so nothing but that formatting can ever show. Each paragraph takes its own direction.
 */
export function RichNoteView({ html, className = '' }: { html: string; className?: string }) {
  return (
    <div className={`rich-text ${className}`}>
      {structure(parseRichHtml(html)).map((b, i) =>
        b.kind === 'list' ? (
          <List key={i} list={b.list} />
        ) : b.kind === 'heading' ? (
          <h3 key={i} dir="auto">
            <Runs runs={b.runs} />
          </h3>
        ) : (
          <p key={i} dir="auto">
            <Runs runs={b.runs} />
          </p>
        ),
      )}
    </div>
  );
}
