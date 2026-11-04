import { describe, it, expect } from 'vitest';
import { createMicoAiActionsPort } from './mico-ai-actions-port';
import { ValidationError } from '../../lib/http-errors';
import type { MeetingCompanyRule } from '../meetings/meeting-company';
import type { MeetingInvitees } from '../meetings/meeting-invitees';

// Companies (MC1 final review): MICO AI's "schedule a meeting" follows POST /meetings' rules — a meeting
// without a project gets its company (the pick, else the organizer's primary company: Ruling 11), and
// everyone invited must be one of the meeting's invite candidates (§8.8).
describe('MICO AI schedule_meeting and companies', () => {
  function make() {
    const created: Record<string, unknown>[] = [];
    const invited: string[] = [];
    const asked: unknown[] = [];
    const meetingCompany: MeetingCompanyRule = {
      async forNew(_viewer, meeting, pick) {
        asked.push(['forNew', meeting, pick]);
        return meeting.projectId ? null : pick ?? 'A';
      },
      async forChange() {
        return undefined;
      },
    };
    const meetingInvitees: MeetingInvitees = {
      async candidates() {
        return [];
      },
      async assertInvitable(_viewer, target, userIds) {
        asked.push(['assertInvitable', target, userIds]);
        if (userIds.includes('bob')) throw new ValidationError('Bob Betaonly can’t be invited: they aren’t in this meeting’s companies.');
      },
    };
    const port = createMicoAiActionsPort({
      prisma: { meeting: { findFirst: async () => null }, project: { findFirst: async () => null } } as never, // (1.22: is the project archived? not here)
      timeZone: 'Asia/Muscat',
      taskService: {} as never,
      assigneeService: {} as never,
      projectAccess: { canViewTask: async () => true, accessibleProjectIds: async () => ['PA'] },
      meetingService: {
        createMeeting: async (input: Record<string, unknown>) => {
          created.push(input);
          return { id: 'm1', ...input } as never;
        },
        deleteMeeting: async () => undefined,
      } as never,
      attendeeService: { addAttendee: async (_m: string, a: { userId: string }) => void invited.push(a.userId) } as never,
      agendaService: { addItem: async () => undefined } as never,
      meetingNotify: {} as never,
      finalMinutes: {} as never,
      minutesFacts: async () => '',
      draftMinutesWithAi: async () => ({}),
      workingDays: async () => [0, 1, 2, 3, 4],
      isActiveUser: async () => true,
      broadcast: () => undefined,
      audit: { record: async () => undefined },
      meetingCompany,
      meetingInvitees,
    });
    return { port, created, invited, asked };
  }
  const ana = { userId: 'ana', roles: ['EMPLOYEE'], pick: null };
  const soon = () => ({ startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000), description: '', agenda: [] });

  it('a meeting without a project gets a company (picked, else the organizer’s primary), as POST /meetings gives it', async () => {
    const { port, created } = make();
    await port.createMeeting(ana, { title: 'Sync', projectId: null, attendeeIds: [], ...soon() }).catch(() => undefined);
    await port.createMeeting({ ...ana, pick: 'B' }, { title: 'Sync B', projectId: null, attendeeIds: [], ...soon() }).catch(() => undefined);
    expect(created.map((c) => c.companyId)).toEqual(['A', 'B']);
  });

  it('people invited by MICO AI pass the same invite check as the meeting form; nothing is made when one fails', async () => {
    const { port, created, invited, asked } = make();
    await expect(port.createMeeting(ana, { title: 'PA sync', projectId: 'PA', attendeeIds: ['bob'], ...soon() })).rejects.toThrow('can’t be invited');
    expect(created).toEqual([]);
    expect(invited).toEqual([]);
    expect(asked).toContainEqual(['assertInvitable', { projectId: 'PA' }, ['bob']]);
  });
});
