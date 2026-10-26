import { describe, it, expect } from 'vitest';
import { filterTaskRecipients, type TaskAudienceFacts } from './recipient-access';

const facts = (over: Partial<TaskAudienceFacts['project'] & object> = {}, assigneeIds = ['assignee']): TaskAudienceFacts => ({
  assigneeIds,
  project: { deletedAt: null, ownerId: 'owner', managerId: 'manager', memberIds: ['member'], ...over },
});

describe('filterTaskRecipients (NTF-03)', () => {
  it('keeps everyone who can see the task: assignees, members, owner, manager, admins', () => {
    const ids = ['assignee', 'member', 'owner', 'manager', 'boss', 'ex-member'];
    expect(filterTaskRecipients(ids, facts(), { adminIds: ['boss'] })).toEqual(['assignee', 'member', 'owner', 'manager', 'boss']);
  });

  it('does not keep someone just because they created the project (they are on its team instead)', () => {
    expect(filterTaskRecipients(['creator'], facts(), { adminIds: [] })).toEqual([]);
  });

  it('drops a watcher who has left the project', () => {
    expect(filterTaskRecipients(['member', 'former-watcher'], facts(), { adminIds: [] })).toEqual(['member']);
  });

  it('skips the actor, inactive users and duplicates', () => {
    expect(filterTaskRecipients(['member', 'member', 'owner', 'manager'], facts(), { adminIds: [], activeIds: ['member', 'manager'], excludeUserId: 'manager' })).toEqual(['member']);
  });

  it('notifies no one about a task whose project was deleted (or is unknown)', () => {
    expect(filterTaskRecipients(['assignee', 'boss'], facts({ deletedAt: new Date() }), { adminIds: ['boss'] })).toEqual([]);
    expect(filterTaskRecipients(['assignee'], { assigneeIds: ['assignee'], project: null }, { adminIds: [] })).toEqual([]);
  });
});
