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

describe('meeting access: the invitation exception (companies)', () => {
  // m3: a project meeting of p2, organizer member2, with guest u5 invited from another company.
  const withInvitee = { ...cores, m3: { organizerId: 'member2', createdById: 'member2', projectId: 'p2', attendeeUserIds: ['u5', 'member2'] } };
  const lookup = { async accessCore(id: string) { return withInvitee[id as keyof typeof withInvitee] ?? null; } };
  // u5 shares no company with p2; everyone else does.
  const meetingView = async (viewer: { id: string }, m: { projectId: string | null }) => (m.projectId && viewer.id === 'u5' ? ('invitee' as const) : ('full' as const));
  const companies = createMeetingAccess({ meetings: lookup, projectAccess, meetingView });

  it('an invitee from outside the project’s companies sees the meeting in the invitee view only', async () => {
    expect(await companies.viewOf('u5', [], 'm3')).toBe('invitee');
    expect(await companies.canViewMeeting('u5', [], 'm3')).toBe(false); // not the full view
    expect(await companies.viewOf('member2', [], 'm3')).toBe('full');
    expect(await companies.viewOf('admin', ['ADMIN'], 'm3')).toBe('full');
    expect(await companies.viewOf('u9', [], 'm3')).toBeNull();
    expect(await companies.viewOf('u1', [], 'ghost')).toBeNull();
  });

  it('a project member who isn’t invited still has the full view; a standalone meeting’s people too', async () => {
    expect(await companies.viewOf('member2', [], 'm2')).toBe('full');
    expect(await companies.viewOf('u2', [], 'm1')).toBe('full');
  });

  it('without the companies rule an invitee keeps today’s full view', async () => {
    expect(await access.viewOf('u2', [], 'm1')).toBe('full');
    expect(await access.viewOf('u9', [], 'm1')).toBeNull();
  });

  // Owner, 3 Nov 2026: "archived means no access" — someone whose companies are all archived sees
  // nothing of a meeting they were invited to (the companies rule says no view: null).
  it('one of the meeting’s people the companies rule refuses (all their companies archived) gets no view', async () => {
    const noAccess = createMeetingAccess({ meetings: lookup, projectAccess, meetingView: async (viewer) => (viewer.id === 'u5' ? null : 'full') });
    expect(await noAccess.viewOf('u5', [], 'm3')).toBeNull();
    expect(await noAccess.canViewMeeting('u5', [], 'm3')).toBe(false);
    expect(await noAccess.viewOf('member2', [], 'm3')).toBe('full');
  });
});
