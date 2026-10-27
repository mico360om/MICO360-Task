import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientInspectionBody, notesNameSomeone } from './ClientInspectionBody';
import type { ClientInspection } from '../../api/inspections';

const report = (over: Partial<ClientInspection> = {}): ClientInspection => ({
  id: 'i1',
  title: 'Rig daily check',
  date: '2026-10-27',
  place: null,
  counts: { total: 3, passed: 1, failed: 2, na: 0 },
  result: '2 failed',
  sections: [{ title: 'Deck', items: [{ label: 'Rails', kind: 'CHECK', result: 'Fail', reading: null, limits: null, note: 'Told Omar Ahmed about it' }] }],
  signatures: [{ role: 'Inspector', name: 'Ivan Inspector', signedAt: '2026-10-27T08:30:00.000Z', image: null, typed: true }],
  unsigned: ['Client'],
  ...over,
});

describe('the client’s copy of a report', () => {
  it('says the result once, then the rest of the count', () => {
    render(<ClientInspectionBody inspection={report()} />);
    expect(screen.getByText('2 failed')).toBeInTheDocument();
    expect(screen.getByText('· 3 items: 1 passed, 0 N/A', { exact: false })).toBeInTheDocument();
  });

  it('marks the project’s people in the notes (the staff preview), and knows when there are any', () => {
    render(<ClientInspectionBody inspection={report()} names={['Omar Ahmed', 'Omar']} />);
    expect(screen.getAllByText('Omar Ahmed').every((el) => el.tagName === 'MARK')).toBe(true);
    expect(notesNameSomeone(report(), ['Omar Ahmed'])).toBe(true);
    expect(notesNameSomeone(report(), ['Sara Ahmed'])).toBe(false);
  });

  it('says which asked-for signature wasn’t given', () => {
    render(<ClientInspectionBody inspection={report()} />);
    expect(screen.getByText('Not signed', { exact: false }).textContent).toContain('Client');
  });
});
