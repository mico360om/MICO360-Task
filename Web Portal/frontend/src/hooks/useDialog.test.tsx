import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useDialog } from './useDialog';

function Dialog({ onClose, label = 'Test dialog' }: { onClose: () => void; label?: string }) {
  const ref = useDialog(onClose);
  const [busy, setBusy] = useState(false);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label}>
      <input aria-label={`${label} name`} />
      {/* Like the shared Button: disabled while the request runs. */}
      <button disabled={busy} onClick={() => setBusy(true)}>Save</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}

describe('useDialog', () => {
  it('moves focus to the first field, closes on Escape and gives focus back to the opener', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Dialog onClose={onClose} />);
    expect(screen.getByLabelText('Test dialog name')).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText('Test dialog name'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps Tab inside the dialog', () => {
    render(<Dialog onClose={vi.fn()} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(screen.getByLabelText('Test dialog name')).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText('Test dialog name'), { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it('still answers the keyboard after focus fell out of it (the focused button was disabled while saving)', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    const save = screen.getByRole('button', { name: 'Save' });
    const field = screen.getByLabelText('Test dialog name');
    save.focus();
    fireEvent.click(save);
    expect(save).toBeDisabled();
    // Chrome and Safari drop focus to <body> at this point: no element in the dialog gets the next key.
    act(() => field.focus());
    act(() => field.blur());
    expect(document.body).toHaveFocus();

    // Tab comes back into the dialog…
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(field).toHaveFocus();
    // …and Escape closes it even from <body>.
    act(() => field.blur());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when focus is stuck on the button that was disabled (Firefox)', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.click(save);
    expect(save).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with two dialogs open, a key pressed outside both goes to the top one only', () => {
    const closeUnder = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Dialog onClose={closeUnder} label="Under" />
        <Dialog onClose={closeTop} label="Top" />
      </>,
    );
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeUnder).not.toHaveBeenCalled();
  });

  it('leaves keys alone when focus is somewhere else on purpose (a menu rendered outside the dialog)', () => {
    const onClose = vi.fn();
    render(
      <>
        <Dialog onClose={onClose} />
        <input aria-label="Outside panel filter" />
      </>,
    );
    const outside = screen.getByLabelText('Outside panel filter');
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
