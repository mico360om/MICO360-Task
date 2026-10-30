import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DateLeaf } from './meeting-card-parts';

describe('DateLeaf: the meeting day as a calendar leaf', () => {
  it('shows the weekday, the day and a three-letter month in the company time zone ("Sep", never "Sept")', () => {
    // 21:30 UTC on Tue 29 Sep is already Wed 30 Sep in Muscat.
    const { container } = render(<DateLeaf iso="2026-09-29T21:30:00.000Z" timeZone="Asia/Muscat" tone="upcoming" />);
    const parts = [...container.firstElementChild!.children].map((el) => el.textContent);
    expect(parts).toEqual(['Wed', '30', 'Sep']);
  });
});
