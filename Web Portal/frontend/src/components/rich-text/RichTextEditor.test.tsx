import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RichTextEditor } from './RichTextEditor';

/** The editor as a page uses it: the HTML it reports back is kept and passed in again. */
function Harness({ initial = '', onSubmit, spy }: { initial?: string; onSubmit?: () => void; spy?: (html: string) => void }) {
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
      <output data-testid="html">{value}</output>
      <button type="button" onClick={() => setValue('')}>Reset</button>
    </>
  );
}

const box = () => screen.getByRole('textbox', { name: 'New note' });
const html = () => screen.getByTestId('html').textContent;
async function selectAll() {
  await userEvent.click(box());
  await userEvent.keyboard('{Control>}a{/Control}');
}

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

  it('reports an empty box as an empty string', async () => {
    const spy = vi.fn();
    render(<Harness initial="<p>x</p>" spy={spy} />);
    await selectAll();
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(''));
  });
});
