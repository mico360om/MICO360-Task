import { describe, it, expect, vi } from 'vitest';
import { useLayoutEffect, useRef, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { RichTextEditor } from './RichTextEditor';

type KeyMidUpdate = { after: string; text: string };

/** The editor as a page uses it: the HTML it reports back is kept and passed in again. */
function Harness({ initial = '', onSubmit, spy, keyMidUpdate }: { initial?: string; onSubmit?: () => void; spy?: (html: string) => void; keyMidUpdate?: KeyMidUpdate }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RichTextEditor
        value={value}
        onChange={(html) => {
          setValue(html);
          spy?.(html);
        }}
        ariaLabel="New note"
        placeholder="Write a discussion…"
        onSubmit={onSubmit}
      />
      {keyMidUpdate ? <KeyPressedMidUpdate value={value} {...keyMidUpdate} /> : null}
      <output data-testid="html">{value}</output>
      <button type="button" onClick={() => setValue('')}>Reset</button>
    </>
  );
}

/**
 * Once the page shows `after`, the box takes in `text` straight away: after React has shown the
 * page's change but before React's effects for it have run — the moment a key pressed while the
 * page is busy can land in.
 */
function KeyPressedMidUpdate({ value, after, text }: KeyMidUpdate & { value: string }) {
  const pressed = useRef(false);
  useLayoutEffect(() => {
    if (pressed.current || value !== after) return;
    pressed.current = true;
    (screen.getByRole('textbox', { name: 'New note' }) as HTMLElement & { editor: Editor }).editor.commands.insertContent(text);
  }, [value, after, text]);
  return null;
}

const box = () => screen.getByRole('textbox', { name: 'New note' });
const html = () => screen.getByTestId('html').textContent;
async function selectAll() {
  await userEvent.click(box());
  await userEvent.keyboard('{Control>}a{/Control}');
}

describe('RichTextEditor: typing fast', () => {
  it('keeps what was typed when the page shows an older copy of it back late', async () => {
    const reported: string[] = [];
    const { rerender } = render(<RichTextEditor value="" onChange={(h) => reported.push(h)} ariaLabel="New note" />);
    await userEvent.click(box());
    await userEvent.keyboard('ab');
    expect(reported).toEqual(['<p>a</p>', '<p>ab</p>']);
    // The page catches up one change at a time: first the words as they were after "a".
    rerender(<RichTextEditor value="<p>a</p>" onChange={(h) => reported.push(h)} ariaLabel="New note" />);
    expect(box()).toHaveTextContent('ab');
    rerender(<RichTextEditor value="<p>ab</p>" onChange={(h) => reported.push(h)} ariaLabel="New note" />);
    expect(box()).toHaveTextContent('ab');
    // The page's own change still comes through: cleared after the note is added, or another note.
    rerender(<RichTextEditor value="" onChange={(h) => reported.push(h)} ariaLabel="New note" />);
    expect(box()).toHaveTextContent('');
    rerender(<RichTextEditor value="<p>Another note</p>" onChange={(h) => reported.push(h)} ariaLabel="New note" />);
    expect(box()).toHaveTextContent('Another note');
  });
});

describe('RichTextEditor', () => {
  it('is a labelled box with a toolbar of formatting buttons, none pressed yet', () => {
    render(<Harness />);
    expect(box()).toHaveAttribute('contenteditable', 'true');
    const toolbar = screen.getByRole('toolbar', { name: /formatting/i });
    for (const name of ['Bold', 'Italic', 'Underline', 'Heading', 'Bulleted list', 'Numbered list', 'Highlight', 'Link']) {
      expect(toolbar.querySelector(`button[aria-label="${name}"]`)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('formats the selected words from the toolbar', async () => {
    render(<Harness initial="<p>Pour the slab</p>" />);
    await selectAll();
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(html()).toBe('<p><strong>Pour the slab</strong></p>'));
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    await waitFor(() => expect(html()).toContain('<mark>'));
    await userEvent.click(screen.getByRole('button', { name: 'Italic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Underline' }));
    await waitFor(() => expect(html()).toMatch(/<em>.*<u>|<u>.*<em>/));
  });

  it('makes lists and a heading', async () => {
    render(<Harness initial="<p>Book the trucks</p>" />);
    await selectAll();
    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));
    await waitFor(() => expect(html()).toBe('<ul><li><p>Book the trucks</p></li></ul>'));
    await userEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    await waitFor(() => expect(html()).toBe('<ol><li><p>Book the trucks</p></li></ol>'));
    await userEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Heading' }));
    await waitFor(() => expect(html()).toBe('<h3>Book the trucks</h3>'));
  });

  it('links the selected words to a web address (https:// added when left out), and refuses anything else', async () => {
    render(<Harness initial="<p>the plan</p>" />);
    await selectAll();
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const field = screen.getByRole('textbox', { name: 'Link address' });
    await userEvent.type(field, 'javascript:alert(1){Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/web or email address/i);
    expect(html()).not.toContain('href');
    await userEvent.clear(field);
    await userEvent.type(field, 'example.com/plan{Enter}');
    await waitFor(() => expect(html()).toContain('href="https://example.com/plan"'));
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument();
    // Typing carries on after the link: it neither replaces the linked words nor joins the link.
    expect(box()).toHaveFocus();
    await userEvent.keyboard(' more');
    await waitFor(() => expect(html()).toMatch(/>the plan<\/a> more<\/p>$/));
  });

  it('sends with Ctrl+Enter, and empties when the page resets it', async () => {
    const onSubmit = vi.fn();
    render(<Harness initial="<p>Done</p>" onSubmit={onSubmit} />);
    await userEvent.click(box());
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(box()).toHaveTextContent(''));
    await act(async () => {});
  });

  it('keeps a key pressed while the page is still taking in the last one', async () => {
    render(<Harness keyMidUpdate={{ after: '<p>Book the</p>', text: ' ' }} />);
    await userEvent.type(box(), 'Book the');
    await waitFor(() => expect(html()).toBe('<p>Book the </p>'));
    expect(box().textContent).toBe('Book the '); // the box still has the space, not the words before it
    await userEvent.keyboard('venue');
    await waitFor(() => expect(html()).toBe('<p>Book the venue</p>'));
    expect(box().textContent).toBe('Book the venue');
  });

  it('reports an empty box as an empty string', async () => {
    const spy = vi.fn();
    render(<Harness initial="<p>x</p>" spy={spy} />);
    await selectAll();
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(''));
  });
});
