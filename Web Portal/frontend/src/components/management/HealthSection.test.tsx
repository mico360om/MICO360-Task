import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HealthSection } from './HealthSection';
import type { HealthRow, HealthRowWeighed } from '../../api/management';

// 1.23.5: the Management page's health table shows the one rule's new reasons, and says "by weight" for a
// project that counts its completion so.
const row = (o: Partial<HealthRowWeighed>): HealthRow => ({
  id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE', color: '#8B1E1E', icon: null, imageUrl: null, owner: null,
  total: 10, done: 6, open: 4, late: 0, completionPct: 60, nextMilestone: null, lateMilestones: 0, lastActivityAt: '2026-11-20T06:00:00.000Z',
  missingChecks: 0, checksDue: 0, checksDone: 0, checksDoneLate: 0, openFollowUps: 0, rag: 'GREEN', reasons: [{ code: 'ON_TRACK', level: 'GREEN', text: 'On track' }],
  ...o,
});

describe('HealthSection — 1.23.5', () => {
  it('“by weight” beside a weighed project’s completion; the new reasons in words', () => {
    render(
      <MemoryRouter>
        <HealthSection
          rows={[
            row({ completionPct: 44, completionBy: 'WEIGHT', rag: 'AMBER', reasons: [{ code: 'BLOCKED', level: 'AMBER', text: '2 tasks blocked for over 7 days' }] }),
            row({ id: 'p2', code: 'OPS', name: 'Operations' }),
          ]}
          today="2026-11-20"
          timeZone="Asia/Muscat"
          onOpen={() => {}}
          onOpenTask={() => {}}
          chosenHidden={false}
          noneAtAll={false}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('by weight').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 tasks blocked for over 7 days').length).toBeGreaterThan(0);
    // The project counting by number says nothing extra.
    expect(screen.getAllByText('by weight').length).toBe(2); // the table and the cards (one project)
  });
});
