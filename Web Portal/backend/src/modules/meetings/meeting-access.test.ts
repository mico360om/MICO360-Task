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

  it('lets only the organizer, creator, project manager or an admin edit (SEC-06)', async () => {
    const managed = createMeetingAccess({
      meetings,
      projectAccess: { ...projectAccess, async canManageProject(userId: string, _roles: string[], projectId: string) { return projectId === 'p2' && userId === 'pm2'; } },
    });
    expect(await managed.canEditMeeting('u1', [], 'm1')).toBe(true); // organizer
    expect(await managed.canEditMeeting('u2', [], 'm1')).toBe(false); // attendee: view only
    expect(await managed.canEditMeeting('member2', [], 'm2')).toBe(false); // project member: view only
    expect(await managed.canEditMeeting('pm2', [], 'm2')).toBe(true); // project manager
    expect(await managed.canEditMeeting('admin', ['ADMIN'], 'm2')).toBe(true);
    expect(await managed.canEditMeeting('admin', ['ADMIN'], 'ghost')).toBe(false);
    // Without a manager lookup, project membership never grants edit rights.
    expect(await access.canEditMeeting('pm2', [], 'm2')).toBe(false);
  });
});
