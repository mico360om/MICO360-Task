import { describe, it, expect } from 'vitest';
import { filterTaskRecipients, type TaskAudienceFacts } from './recipient-access';

const facts = (over: Partial<TaskAudienceFacts['project'] & object> = {}, assigneeIds = ['assignee']): TaskAudienceFacts => ({
  assigneeIds,
  project: { deletedAt: null, ownerId: 'owner', managerId: 'manager', memberIds: ['member'], companyIds: ['c1'], ...over },
});
// Companies: everyone named in these tests belongs to the project's company c1 unless a test says otherwise.
const PEOPLE = ['assignee', 'member', 'owner', 'manager', 'boss', 'ex-member', 'creator', 'former-watcher'];
const companiesOf = new Map(PEOPLE.map((id) => [id, ['c1']]));

describe('filterTaskRecipients (NTF-03)', () => {
  it('keeps everyone who can see the task: assignees, members, owner, manager, admins', () => {
    const ids = ['assignee', 'member', 'owner', 'manager', 'boss', 'ex-member'];
    expect(filterTaskRecipients(ids, facts(), { adminIds: ['boss'], companiesOf })).toEqual(['assignee', 'member', 'owner', 'manager', 'boss']);
  });

  it('does not keep someone just because they created the project (they are on its team instead)', () => {
    expect(filterTaskRecipients(['creator'], facts(), { adminIds: [], companiesOf })).toEqual([]);
  });

  it('drops a watcher who has left the project', () => {
    expect(filterTaskRecipients(['member', 'former-watcher'], facts(), { adminIds: [], companiesOf })).toEqual(['member']);
  });

  it('skips the actor, inactive users and duplicates', () => {
    expect(filterTaskRecipients(['member', 'member', 'owner', 'manager'], facts(), { adminIds: [], activeIds: ['member', 'manager'], excludeUserId: 'manager', companiesOf })).toEqual(['member']);
  });

  it('notifies no one about a task whose project was deleted (or is unknown)', () => {
    expect(filterTaskRecipients(['assignee', 'boss'], facts({ deletedAt: new Date() }), { adminIds: ['boss'], companiesOf })).toEqual([]);
    expect(filterTaskRecipients(['assignee'], { assigneeIds: ['assignee'], project: null }, { adminIds: [], companiesOf })).toEqual([]);
  });

  it('companies: the team hears about a task only while they share one of its project’s active companies', () => {
    const elsewhere = new Map([...companiesOf, ['member', ['c2']], ['assignee', []]]);
    expect(filterTaskRecipients(['assignee', 'member', 'owner', 'boss'], facts(), { adminIds: ['boss'], companiesOf: elsewhere })).toEqual(['owner', 'boss']);
    // A project in two companies reaches the team of either.
    expect(filterTaskRecipients(['member', 'owner'], facts({ companyIds: ['c1', 'c2'] }), { adminIds: [], companiesOf: elsewhere })).toEqual(['member', 'owner']);
    // A project whose companies are all archived (no active company) reaches only admins.
    expect(filterTaskRecipients(['owner', 'boss'], facts({ companyIds: [] }), { adminIds: ['boss'], companiesOf })).toEqual(['boss']);
  });
});
