import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecurrenceEditor } from './RecurrenceEditor';

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

  it('sets a day of month for a monthly rule', () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor value={{ freq: 'MONTHLY', interval: 1 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/day of month/i), { target: { value: '15' } });
    expect(onChange).toHaveBeenLastCalledWith({ freq: 'MONTHLY', interval: 1, dayOfMonth: 15 });
  });
});
