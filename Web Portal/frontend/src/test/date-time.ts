import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dayText } from '../lib/day-words';

/**
 * Tests: set a DateTimeField (e.g. a meeting's Starts) to a wall time 'YYYY-MM-DDTHH:mm' the way a
 * person does — the day from its calendar (turning the months), the time from its list.
 */
export async function setWhen(label: string, value: string): Promise<void> {
  const [day, time] = value.split('T') as [string, string | undefined];
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}: day`) }));
  const cal = screen.getByRole('dialog', { name: 'Choose a day' });
  for (let i = 0; i < 120; i++) {
    const shown = cal.querySelector('[data-month]')!.getAttribute('data-month')!;
    if (shown === day.slice(0, 7)) break;
    await userEvent.click(within(cal).getByRole('button', { name: shown < day.slice(0, 7) ? 'Next month' : 'Previous month' }));
  }
  await userEvent.click(within(cal).getByRole('button', { name: dayText(day, { weekday: 'short' }) }));
  if (time) {
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}: time`) }));
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: time }));
  }
}

/** Tests: a DateTimeField's value ('YYYY-MM-DDTHH:mm', '' for none). */
export function whenOf(label: string): string | null {
  return screen.getByRole('group', { name: label }).getAttribute('data-value');
}
