import { describe, it, expect } from 'vitest';
import { createMeetingAccess } from './meeting-access';
import type { MeetingAccessCore } from './meeting-repository';

// m1: standalone (organizer u1, attendee u2). m2: project p2 meeting (organizer u3).
const cores: Record<string, MeetingAccessCore> = {
  m1: { organizerId: 'u1', createdById: 'u1', projectId: null, attendeeUserIds: ['u2'] },
  m2: { organizerId: 'u3', createdById: 'u3', projectId: 'p2', attendeeUserIds: [] },
};
const meetings = { async accessCore(id: string) { return cores[id] ?? null; } };
const projectAccess = {
  async canViewProject(userId: string, roles: string[], projectId: string) { return roles.includes('ADMIN') || (projectId === 'p2' && userId === 'member2'); },
  async accessibleProjectIds(userId: string, roles: string[]) { return roles.includes('ADMIN') ? null : userId === 'member2' ? ['p2'] : []; },
};
const access = createMeetingAccess({ meetings, projectAccess });

describe('meeting access', () => {
  it('lets the organizer, creator and attendees view a standalone meeting; denies outsiders', async () => {
    expect(await access.canViewMeeting('u1', [], 'm1')).toBe(true); // organizer
    expect(await access.canViewMeeting('u2', [], 'm1')).toBe(true); // attendee
    expect(await access.canViewMeeting('u9', [], 'm1')).toBe(false); // outsider
  });

  it('lets a project member view a project meeting; denies a non-member', async () => {
    expect(await access.canViewMeeting('member2', [], 'm2')).toBe(true);
    expect(await access.canViewMeeting('u9', [], 'm2')).toBe(false);
  });

  it('lets an admin view anything and returns null accessible-project scope', async () => {
    expect(await access.canViewMeeting('admin', ['ADMIN'], 'm2')).toBe(true);
    expect(await access.accessibleProjectIds('admin', ['ADMIN'])).toBeNull();
  });

  it('returns false for an unknown meeting', async () => {
    expect(await access.canViewMeeting('u1', [], 'ghost')).toBe(false);
  });
});
