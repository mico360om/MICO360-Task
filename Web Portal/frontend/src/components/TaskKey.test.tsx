import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoundTaskKey, TaskKey, TaskKeyButton, bodyWithoutKey } from './TaskKey';

describe('TaskKey (1.22.3: one look for a task number)', () => {
  it('is the small grey mono chip the board cards use, with theme tokens', () => {
    render(<TaskKey value="MICO-142" />);
    const chip = screen.getByText('MICO-142');
    expect(chip).toHaveAttribute('data-task-key', 'MICO-142');
    for (const c of ['rounded', 'bg-ground', 'px-1.5', 'py-0.5', 'font-mono', 'text-[11px]', 'text-ink-2']) expect(chip).toHaveClass(c);
  });

  it('never wraps or shrinks, so a long number stays on one line beside a truncating title', () => {
    render(<TaskKey value="MICO360-10" />);
    const chip = screen.getByText('MICO360-10');
    expect(chip).toHaveClass('whitespace-nowrap');
    expect(chip).toHaveClass('shrink-0');
    expect(chip.className).not.toMatch(/\btruncate\b|\bw-\d/);
  });

  it('reads left to right inside Arabic text and is never translated', () => {
    render(<TaskKey value="MICO-7" />);
    const chip = screen.getByText('MICO-7');
    expect(chip).toHaveAttribute('dir', 'ltr');
    expect(chip).toHaveAttribute('translate', 'no');
  });

  it('has a larger size for the task panel header (the size of its other pills)', () => {
    render(<TaskKey value="MICO-1" size="lg" />);
    const chip = screen.getByText('MICO-1');
    expect(chip).toHaveClass('text-xs', 'font-semibold', 'rounded-md');
    expect(chip).not.toHaveClass('text-[11px]');
    expect(chip).toHaveClass('whitespace-nowrap', 'shrink-0', 'bg-ground', 'font-mono');
  });

  it('a dense chip adds no height to a one-line row (the calendar month grid)', () => {
    render(<TaskKey value="MICO-1" dense />);
    const chip = screen.getByText('MICO-1');
    expect(chip).toHaveClass('py-0');
    expect(chip).not.toHaveClass('py-0.5');
  });

  it('in a row of a list, table or board: its own padding goes only in compact (1.23.0)', () => {
    render(<TaskKey value="MICO-1" dense="compact" />);
    const chip = screen.getByText('MICO-1');
    // Comfortable: as before. Compact (desktop only, the compact: variant): no vertical padding.
    expect(chip).toHaveClass('py-0.5', 'compact:py-0');
  });

  it('shows nothing without a number', () => {
    const { container } = render(<TaskKey value={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TaskKeyButton (the number is the link to the task)', () => {
  it('puts the chip inside the button, which opens the task', async () => {
    const onOpen = vi.fn();
    render(<TaskKeyButton value="MICO-9" title="Fix the pump" onClick={onOpen} />);
    const button = screen.getByRole('button', { name: 'Open MICO-9: Fix the pump' });
    expect(button.querySelector('[data-task-key="MICO-9"]')).not.toBeNull();
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('in a sentence ("Ada updated MICO-9") its name is the number it shows', () => {
    render(<TaskKeyButton value="MICO-9" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'MICO-9' })).toBeInTheDocument();
  });

  it('is 44px tall on a touch screen', () => {
    render(<TaskKeyButton value="MICO-9" onClick={() => {}} />);
    expect(screen.getByRole('button').className).toContain('[@media(pointer:coarse)]:!min-h-11');
  });
});

describe('FoundTaskKey (a search result: the number, and the ones it had before a move)', () => {
  it('shows the chip, then "(was RIG-4)" as quieter words outside it', () => {
    const { container } = render(<FoundTaskKey value="OPS-17" former={['RIG-4']} />);
    expect(screen.getByText('OPS-17')).toHaveAttribute('data-task-key', 'OPS-17');
    expect(screen.getByText('(was RIG-4)')).not.toHaveAttribute('data-task-key');
    expect(container.firstElementChild).toHaveTextContent('OPS-17 (was RIG-4)');
  });
  it('is just the chip for a task that never moved', () => {
    const { container } = render(<FoundTaskKey value="OPS-17" former={[]} />);
    expect(container.firstElementChild).toHaveTextContent(/^OPS-17$/);
  });
});

describe('bodyWithoutKey (a notice shows its number once)', () => {
  it('drops a leading "<number> · " when the chip is shown', () => {
    expect(bodyWithoutKey('MICO-142 · Fix the pump', 'MICO-142')).toBe('Fix the pump');
  });
  it('drops an older number too (the task moved since): the chip shows the current one', () => {
    expect(bodyWithoutKey('RIG-4 · Fix the pump', 'MICO-142')).toBe('Fix the pump');
  });
  it('keeps a body that does not start with a number', () => {
    expect(bodyWithoutKey('Fix the pump', 'MICO-142')).toBe('Fix the pump');
    expect(bodyWithoutKey('Ada: see MICO-142 · today', 'MICO-142')).toBe('Ada: see MICO-142 · today');
  });
  it('keeps everything without a chip, and a body that is only the number goes', () => {
    expect(bodyWithoutKey('MICO-142 · Fix the pump', null)).toBe('MICO-142 · Fix the pump');
    expect(bodyWithoutKey('MICO-142', 'MICO-142')).toBe('');
    expect(bodyWithoutKey(null, 'MICO-142')).toBe('');
  });
  it('keeps the lines after the first (a comment notice: number and title, then the words)', () => {
    expect(bodyWithoutKey('MICO-1 · Pump\n“Looks fine”', 'MICO-1')).toBe('Pump\n“Looks fine”');
  });
});
