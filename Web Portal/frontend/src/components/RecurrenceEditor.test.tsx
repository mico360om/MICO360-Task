import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecurrenceEditor, withFrequency } from './RecurrenceEditor';

describe('RecurrenceEditor', () => {
  it('shows "Does not repeat" and no interval control when the value is null', () => {
    render(<RecurrenceEditor value={null} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/repeat/i) as HTMLSelectElement).value).toBe('NONE');
    expect(screen.queryByLabelText(/repeat every/i)).not.toBeInTheDocument();
  });

  it('emits a default rule when a frequency is chosen', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={null} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/^repeat$/i), 'WEEKLY');
    expect(onChange).toHaveBeenCalledWith({ freq: 'WEEKLY', interval: 1 });
  });

  it('emits null when switched back to "Does not repeat"', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'DAILY', interval: 2 }} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/^repeat$/i), 'NONE');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('updates the interval', () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'DAILY', interval: 1 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/repeat every/i), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'DAILY', interval: 3 });
  });

  it('toggles weekdays for a weekly rule', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'WEEKLY', interval: 1, weekdays: [1] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^Wed$/i })); // add Wednesday (3)
    expect(onChange).toHaveBeenCalledWith({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3] });
  });

  it('offers "the 2nd Tuesday" for a monthly rule, picked from the due date', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'MONTHLY', interval: 1, dayOfMonth: 13 }} dueDate="2026-10-13" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/monthly on/i), 'WEEKDAY');
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } });
  });

  it('changes the week and the weekday of a "2nd Tuesday" rule, and can go back to a date', async () => {
    const onChange = vi.fn();
    const rule = { freq: 'MONTHLY' as const, interval: 1, nthWeekday: { week: 2 as const, day: 2 } };
    render(<RecurrenceEditor value={rule} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/week of the month/i), '-1');
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, nthWeekday: { week: -1, day: 2 } });
    await userEvent.selectOptions(screen.getByLabelText(/^weekday$/i), '5');
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, nthWeekday: { week: 2, day: 5 } });
    await userEvent.selectOptions(screen.getByLabelText(/monthly on/i), 'DATE');
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'MONTHLY', interval: 1 });
  });

  it('chooses when the next copy is made', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'DAILY', interval: 1 }} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/create the next copy/i), 'ON_SCHEDULE');
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' });
  });

  it('keeps the end and copy settings when the frequency changes', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'MONTHLY', interval: 2, dayOfMonth: 5, count: 5, createNext: 'ON_SCHEDULE' }} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/^repeat$/i), 'WEEKLY');
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'WEEKLY', interval: 2, count: 5, createNext: 'ON_SCHEDULE' });
  });

  it('previews the next dates from the due date', () => {
    render(<RecurrenceEditor value={{ freq: 'WEEKLY', interval: 1, weekdays: [0, 4] }} dueDate="2026-10-01" onChange={vi.fn()} />);
    expect(screen.getByText(/^Next:/)).toHaveTextContent('Next: Sun, Oct 4 · Thu, Oct 8 · Sun, Oct 11');
  });

  it('sets a day of month for a monthly rule', () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'MONTHLY', interval: 1 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/day of month/i), { target: { value: '15' } });
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'MONTHLY', interval: 1, dayOfMonth: 15 });
  });

  it('compact: the choice fills its row, its own “Repeat” label kept for screen readers only', () => {
    render(<RecurrenceEditor value={null} onChange={vi.fn()} compact />);
    expect(screen.getByText('Repeat', { selector: 'span' })).toHaveClass('sr-only');
    expect(screen.getByLabelText('Repeat')).toHaveClass('w-full');
  });

  it('can leave the frequency to the form around it, showing only the schedule options', () => {
    render(<RecurrenceEditor value={{ freq: 'DAILY', interval: 2 }} onChange={vi.fn()} hideFrequency />);
    expect(screen.queryByLabelText('Repeat')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Repeat every')).toHaveValue(2);
  });

  it('weekly without chosen days: the due date’s weekday shows as chosen, and adding a day keeps it', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'WEEKLY', interval: 1 }} dueDate="2026-10-01" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Mon' }));
    expect(onChange).toHaveBeenCalledWith({ freq: 'WEEKLY', interval: 1, weekdays: [1, 4] });
  });

  it('withFrequency: a new frequency keeps how the series ends and drops the old day choices', () => {
    expect(withFrequency(null, 'NONE')).toBeNull();
    expect(withFrequency(null, 'DAILY')).toEqual({ freq: 'DAILY', interval: 1 });
    expect(withFrequency({ freq: 'WEEKLY', interval: 2, weekdays: [1], count: 4, createNext: 'ON_SCHEDULE' }, 'MONTHLY')).toEqual({ freq: 'MONTHLY', interval: 2, count: 4, createNext: 'ON_SCHEDULE' });
  });

  it('a scheduled check: no "next copy" choice and no pause (every check is made on its day), counted in checks', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor kind="check" value={{ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE', count: 5 }} onChange={onChange} />);
    expect(screen.queryByLabelText('Create the next copy')).toBeNull();
    expect(screen.queryByRole('button', { name: /Pause series/ })).toBeNull();
    expect(screen.getByText('check(s)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Number of occurrences'), { target: { value: '8' } });
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE', count: 8, until: null });
  });

  it('can show only how the repeat ends (a preset picked the rest)', async () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor kind="check" only="ends" value={{ freq: 'WEEKLY', interval: 1, weekdays: [0, 1, 2, 3, 4], createNext: 'ON_SCHEDULE' }} onChange={onChange} />);
    expect(screen.queryByLabelText('Repeat every')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mon' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Ends'), 'COUNT');
    expect(onChange).toHaveBeenCalledWith({ freq: 'WEEKLY', interval: 1, weekdays: [0, 1, 2, 3, 4], createNext: 'ON_SCHEDULE', count: 10, until: null });
  });
});
