import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MeetingCard } from './MeetingCard';
import type { Meeting } from '../../api/meetings';

// 1.23: a meeting in a series shows a Series chip on its card; its name opens the Series page.
const m = (over: Partial<Meeting>): Meeting => ({
  id: 'm1', title: 'Monthly 3', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: '2026-11-03T06:00:00.000Z', endAt: null, timeZone: null, recurrenceRule: null,
  recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'u1',
  createdAt: '', updatedAt: '', ...over,
});
const card = (meeting: Meeting) =>
  render(
    <MemoryRouter>
      <MeetingCard meeting={meeting} timeZone="Asia/Muscat" now={new Date('2026-11-01T06:00:00Z')} project={null} organizer={null} actions={[]} />
    </MemoryRouter>,
  );

describe('the Series chip on a meeting card', () => {
  it('names the series and opens its page', () => {
    card(m({ seriesId: 's1', seriesName: 'Monthly OXY review' }));
    const chip = screen.getByRole('link', { name: 'Series: Monthly OXY review' });
    expect(chip).toHaveAttribute('href', '/meetings/series/s1');
    // The card's own link still opens the meeting.
    expect(screen.getByRole('link', { name: 'Monthly 3' })).toHaveAttribute('href', '/meetings/m1');
  });

  it('shows nothing for a meeting in no series', () => {
    card(m({ seriesId: null, seriesName: null }));
    expect(screen.queryByRole('link', { name: /^Series:/ })).not.toBeInTheDocument();
  });
});
