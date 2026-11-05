import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { carriedTableGroups } from './carried-groups';
import type { CarriedItem } from '../../../api/meeting-series';

// 1.23 integration (Table view × meeting series, design call 2 of the table design): the series' "Open from
// earlier meetings" as the meeting table's last group — the same items, a "from 3 Nov" note, and the
// section's own edit rule (status only, where the section lets it be changed).
const NOW = new Date('2026-11-05T08:00:00.000Z');
const carried = (over: Partial<CarriedItem> = {}): CarriedItem => ({
  id: 'ai1', description: 'Send the drawings', assigneeId: 'u2', assigneeName: 'Bilal Said', status: 'OPEN', priority: 'HIGH',
  dueDate: '2026-10-20T00:00:00.000Z', overdue: true, taskId: 't9', taskKey: 'MICO-9', createdById: 'me',
  meeting: { id: 'm1', title: 'Monthly 1', startAt: '2026-11-03T06:00:00.000Z' }, ...over,
});

describe('carriedTableGroups', () => {
  it('nothing carried: no group', () => {
    expect(carriedTableGroups([], { timeZone: 'Asia/Muscat', editable: true, now: NOW })).toEqual([]);
  });

  it('one group "Open from earlier meetings" with the same items as action items of their own meetings', () => {
    const [group, ...rest] = carriedTableGroups([carried()], { timeZone: 'Asia/Muscat', editable: true, now: NOW });
    expect(rest).toEqual([]);
    expect(group).toMatchObject({ key: 'carried', label: 'Open from earlier meetings' });
    expect(group!.items).toEqual([
      expect.objectContaining({
        id: 'ai1', meetingId: 'm1', agendaItemId: null, sourceNoteId: null, description: 'Send the drawings', assigneeId: 'u2',
        priority: 'HIGH', status: 'OPEN', dueDate: '2026-10-20T00:00:00.000Z', overdue: true, taskId: 't9', taskKey: 'MICO-9', createdById: 'me',
      }),
    ]);
  });

  it('notes the meeting each came from ("from 3 Nov"), linked to it', () => {
    const [group] = carriedTableGroups([carried()], { timeZone: 'Asia/Muscat', editable: true, now: NOW });
    render(<MemoryRouter>{group!.note!(group!.items[0]!)}</MemoryRouter>);
    const link = screen.getByRole('link', { name: 'from 3 Nov: Monthly 1' });
    expect(link).toHaveTextContent('from 3 Nov');
    expect(link).toHaveAttribute('href', '/meetings/m1');
  });

  it('a meeting of another year says its year', () => {
    const [group] = carriedTableGroups([carried({ meeting: { id: 'm0', title: 'Kick-off', startAt: '2025-12-01T06:00:00.000Z' } })], { timeZone: 'Asia/Muscat', editable: false, now: NOW });
    render(<MemoryRouter>{group!.note!(group!.items[0]!)}</MemoryRouter>);
    expect(screen.getByRole('link', { name: 'from 1 Dec 2025: Kick-off' })).toBeInTheDocument();
  });

  it('names each item’s owner as the series gave it (they may not be among this meeting’s people)', () => {
    const [group] = carriedTableGroups([carried()], { timeZone: 'Asia/Muscat', editable: true, now: NOW });
    expect(group!.ownerName!(group!.items[0]!)).toBe('Bilal Said');
  });

  it('the section’s edit rule: only the status, and only where the section may change it', () => {
    const [mine] = carriedTableGroups([carried()], { timeZone: 'Asia/Muscat', editable: true, now: NOW });
    expect([...mine!.editable!(mine!.items[0]!)]).toEqual(['status']);
    const [theirs] = carriedTableGroups([carried()], { timeZone: 'Asia/Muscat', editable: false, now: NOW });
    expect(theirs!.editable).toBeUndefined();
  });
});
