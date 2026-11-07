import { describe, it, expect } from 'vitest';
import { doneCell, milestoneCell } from './management-pdf';

// 1.23.5: the Done column says when a project counts completion by weight.
describe('Management PDF: the Done cell', () => {
  it('"62%", or "62% by weight"', () => {
    expect(doneCell({ completionPct: 62, completionBy: 'COUNT' })).toBe('62%');
    expect(doneCell({ completionPct: 62, completionBy: 'WEIGHT' })).toBe('62% by weight');
  });
});

// 1.22.3: the Management PDF names a project's next milestone by its number too, as the page does.
describe('Management PDF: the next milestone cell', () => {
  const m = { id: 'r1', key: 'RIG-1', title: 'Handover', due: '2026-10-24', daysLeft: 5, waiting: false };
  it('reads "RIG-1 · Handover · 24 Oct 2026"', () => {
    expect(milestoneCell(m)).toBe('RIG-1 · Handover · 24 Oct 2026');
  });
  it('says when it is late, or waiting for approval, or has no date', () => {
    expect(milestoneCell({ ...m, daysLeft: -3 })).toBe('RIG-1 · Handover · 24 Oct 2026 (3 days late)');
    expect(milestoneCell({ ...m, daysLeft: -3, waiting: true })).toBe('RIG-1 · Handover · 24 Oct 2026 (waiting for approval)');
    expect(milestoneCell({ ...m, due: null, daysLeft: null })).toBe('RIG-1 · Handover · no date');
  });
  it('a project without one shows a dash', () => {
    expect(milestoneCell(null)).toBe('—');
  });
});
