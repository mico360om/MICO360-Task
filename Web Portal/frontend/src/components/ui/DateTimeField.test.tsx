import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateTimeField, DayPickerButton, timeOptions } from './DateTimeField';

function Harness({ initial = '2026-11-04T13:00', clearable = false, fill, onChange }: { initial?: string; clearable?: boolean; fill?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <span id="lbl">Starts</span>
      <DateTimeField
        label="Starts"
        labelId="lbl"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        today="2026-11-03"
        weekStart={0}
        clearable={clearable}
        fill={fill}
      />
      <output aria-label="value">{value}</output>
    </>
  );
}

describe('DateTimeField: the site’s day and 24-hour time', () => {
  it('shows the day and time as the site writes them: "Wed 4 Nov 2026" · "13:00"', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Starts' });
    expect(within(group).getByRole('button', { name: 'Starts: day, Wed 4 Nov 2026' })).toHaveTextContent('Wed 4 Nov 2026');
    expect(within(group).getByRole('button', { name: 'Starts: time, 13:00' })).toHaveTextContent('13:00');
    expect(group).toHaveTextContent('Wed 4 Nov 2026·13:00');
  });

  it('a day is picked from a month calendar (the week starting on the set day), today marked', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^Starts: day/ }));
    const cal = screen.getByRole('dialog', { name: 'Choose a day' });
    expect(within(cal).getByText('November 2026')).toBeInTheDocument();
    expect(within(cal).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(within(cal).getByRole('button', { name: 'Wed 4 Nov 2026' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cal).getByRole('button', { name: 'Tue 3 Nov 2026' })).toHaveAttribute('aria-current', 'date');
    await userEvent.click(within(cal).getByRole('button', { name: 'Previous month' }));
    expect(within(cal).getByText('October 2026')).toBeInTheDocument();
    await userEvent.click(within(cal).getByRole('button', { name: 'Thu 1 Oct 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01T13:00');
    expect(screen.queryByRole('dialog', { name: 'Choose a day' })).not.toBeInTheDocument();
    // Focus goes back to the day it opened from.
    expect(screen.getByRole('button', { name: /^Starts: day/ })).toHaveFocus();
  });

  it('the calendar answers the arrow keys, Enter picks, Escape closes', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^Starts: day/ }));
    expect(screen.getByRole('button', { name: 'Wed 4 Nov 2026' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Thu 12 Nov 2026' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}'); // into October: the month follows
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thu 22 Oct 2026' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-22T13:00');
    await userEvent.click(screen.getByRole('button', { name: /^Starts: day/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose a day' })).not.toBeInTheDocument();
  });

  it('the time is a 24-hour list in quarter hours (a time between them is kept as it is)', async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-11-04T13:20" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Starts: time, 13:20' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent('00:00');
    expect(within(list).getByRole('option', { name: '13:20' })).toBeInTheDocument();
    expect(within(list).queryByRole('option', { name: /AM|PM/ })).toBeNull();
    await userEvent.click(within(list).getByRole('option', { name: '17:45' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-11-04T17:45');
    expect(timeOptions('').map((o) => o.label)).toHaveLength(96);
  });

  it('an optional end can be cleared, and filled from the start when set again', async () => {
    const onChange = vi.fn();
    render(<Harness initial="" clearable fill="2026-11-04T14:00" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Starts: day, not set' })).toHaveTextContent('Not set');
    await userEvent.click(screen.getByRole('button', { name: 'Starts: time, not set' }));
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '15:00' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-11-04T15:00');
    await userEvent.click(screen.getByRole('button', { name: 'Clear Starts' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('44px targets on a touch screen', () => {
    render(<Harness clearable />);
    // 44px on a touch screen, or always (the time list's box is the form fields' 44px).
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11|!min-h-\[44px\]/);
  });
});

// 1.22 QA: on a phone (375×812) the Starts calendar opened below its field at y 452, 404px tall, so its
// Today / Clear row was below the screen — there was room neither below nor above the field.
describe('DateTimeField: the calendar stays on the screen', () => {
  it('with no room below or above its field, it is moved up to fit, never past the screen’s edge', async () => {
    const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 });
    const offH = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(404);
    const offW = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(304);
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 402, bottom: 446, left: 16, right: 200, width: 184, height: 44, x: 16, y: 402, toJSON: () => ({}) } as DOMRect);
    try {
      render(<Harness />);
      await userEvent.click(screen.getByRole('button', { name: 'Starts: day, Wed 4 Nov 2026' }));
      const box = screen.getByRole('dialog', { name: 'Choose a day' });
      const top = parseFloat(box.style.top);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(top + 404).toBeLessThanOrEqual(812 - 8);
    } finally {
      offH.mockRestore();
      offW.mockRestore();
      rect.mockRestore();
      if (height) Object.defineProperty(window, 'innerHeight', height);
    }
  });
});

describe('DayPickerButton (a due date chip)', () => {
  it('shows the day or "No due date", picks a day, and can clear it', async () => {
    const onPick = vi.fn();
    render(<DayPickerButton ariaLabel="Due date for Book the room: 30 Oct 2026" value="2026-10-30" onPick={onPick} today="2026-11-03" weekStart={1} clearLabel="No due date" placeholder="No due date" />);
    const chip = screen.getByRole('button', { name: 'Due date for Book the room: 30 Oct 2026' });
    await userEvent.click(chip);
    const cal = screen.getByRole('dialog', { name: 'Choose a day' });
    expect(within(cal).getAllByRole('columnheader')[0]).toHaveTextContent('Mon');
    await userEvent.click(within(cal).getByRole('button', { name: 'Sat 31 Oct 2026' }));
    expect(onPick).toHaveBeenLastCalledWith('2026-10-31');
    await userEvent.click(chip);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Choose a day' })).getByRole('button', { name: 'No due date' }));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });
});
