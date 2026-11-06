import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthBar } from './MonthBar';

// Kanban Board: Monthly View — the month bar.
function bar(props: Partial<Parameters<typeof MonthBar>[0]> = {}) {
  const onChange = vi.fn();
  const onShowUndated = vi.fn();
  render(<MonthBar month="2026-11" thisMonth="2026-11" onChange={onChange} undated={0} showUndated={false} onShowUndated={onShowUndated} {...props} />);
  return { onChange, onShowUndated };
}

describe('MonthBar', () => {
  it('names the month shown, and steps a month back or on (across years)', async () => {
    const { onChange } = bar({ month: '2026-12' });
    expect(screen.getByRole('group', { name: 'Month: December 2026' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onChange).toHaveBeenLastCalledWith('2027-01');
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-11');
  });

  it('picks a month and a year', async () => {
    const { onChange } = bar();
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveValue('11');
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveValue('2026');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Month' }), 'March');
    expect(onChange).toHaveBeenLastCalledWith('2026-03');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2028');
    expect(onChange).toHaveBeenLastCalledWith('2028-11');
  });

  it('“This month” only when another month is shown', async () => {
    bar();
    expect(screen.queryByRole('button', { name: 'This month' })).not.toBeInTheDocument();
  });

  it('“This month” goes back to it', async () => {
    const { onChange } = bar({ month: '2026-08' });
    await userEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-11');
  });

  it('“No date (12)” adds the tasks without dates, and says when it is on', async () => {
    const { onShowUndated } = bar({ undated: 12 });
    const chip = screen.getByRole('button', { name: 'No date (12)' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(onShowUndated).toHaveBeenCalledWith(true);
  });

  it('no chip when every task has dates (unless it is on)', () => {
    bar();
    expect(screen.queryByRole('button', { name: /No date/ })).not.toBeInTheDocument();
  });

  it('on, it stays to be switched off', () => {
    bar({ undated: 0, showUndated: true });
    expect(screen.getByRole('button', { name: 'No date (0)' })).toHaveAttribute('aria-pressed', 'true');
  });
});
