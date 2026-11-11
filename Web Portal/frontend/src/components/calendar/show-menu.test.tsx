import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShowMenu } from './CalendarToolbar';

const ALL = { tasks: true, meetings: true, blocks: true, reminders: true };

describe('the Show menu', () => {
  it('a box changes as soon as it is clicked, before the saved choice comes back', () => {
    const onShow = vi.fn();
    const onTeam = vi.fn();
    // The parent hasn't caught up yet: it still passes the old choices.
    render(<ShowMenu show={ALL} onShow={onShow} team={{ available: true, on: false }} onTeam={onTeam} />);
    fireEvent.click(screen.getByRole('button', { name: /^Show/ }));
    const planned = screen.getByRole('checkbox', { name: 'Planned time' });
    fireEvent.click(planned);
    expect(planned).not.toBeChecked();
    expect(onShow).toHaveBeenCalledWith({ blocks: false });
    const team = screen.getByRole('checkbox', { name: 'Team’s planned time' });
    fireEvent.click(team);
    expect(team).toBeChecked();
    expect(onTeam).toHaveBeenCalledWith(true);
  });

  it('follows the saved choices when they change (or a failed save puts them back)', () => {
    const { rerender } = render(<ShowMenu show={ALL} onShow={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Show/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Meetings' }));
    expect(screen.getByRole('checkbox', { name: 'Meetings' })).not.toBeChecked();
    // The save failed: the page passes the old choices again.
    rerender(<ShowMenu show={{ ...ALL }} onShow={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Meetings' })).toBeChecked();
    rerender(<ShowMenu show={{ ...ALL, reminders: false }} onShow={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'My reminders' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /^Show/ })).toHaveTextContent('Show (3 of 4)');
  });
});
