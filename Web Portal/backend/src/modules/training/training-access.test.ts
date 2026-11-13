import { describe, expect, it } from 'vitest';
import { canLearn, courseVisible, inScope, isManager, moduleShown, moduleVisible, reportScope, type CourseFacts, type LearnerFacts } from './training-access';

const staff = (o: Partial<LearnerFacts> = {}): LearnerFacts => ({ id: 'u', client: false, admin: false, trainingManager: false, runsProject: false, companyIds: ['A'], ...o });
const admin = staff({ admin: true, companyIds: [] });
const runner = staff({ runsProject: true });
const tm = staff({ trainingManager: true });
const client = staff({ client: true, companyIds: ['A'] });
const course = (o: Partial<CourseFacts> = {}): CourseFacts => ({ audience: 'STAFF', moduleKey: 'tasks', roleKeys: [], companyIds: [], status: 'PUBLISHED', ...o });

describe('R1 module visibility (staff courses)', () => {
  it('Reports and Admin settings: administrators only', () => {
    for (const m of ['reports', 'admin']) {
      expect(moduleVisible(m, admin)).toBe(true);
      expect(moduleVisible(m, runner)).toBe(false);
      expect(moduleVisible(m, tm)).toBe(false);
      expect(moduleVisible(m, staff())).toBe(false);
    }
  });
  it('Management: administrators and people who run a project', () => {
    expect(moduleVisible('management', admin)).toBe(true);
    expect(moduleVisible('management', runner)).toBe(true);
    expect(moduleVisible('management', staff())).toBe(false);
  });
  it('every other module: all staff; the Client portal module is for clients only', () => {
    for (const m of ['tasks', 'board', 'meetings', 'calendar', 'projects', 'chat', 'mico-ai', 'training', 'general']) expect(moduleVisible(m, staff())).toBe(true);
    expect(moduleVisible('portal', staff())).toBe(false);
    expect(moduleVisible('portal', admin)).toBe(false);
    expect(moduleVisible('nonsense', admin)).toBe(false);
  });
});

describe('course visibility', () => {
  it('a client sees only courses for clients; staff never see client courses', () => {
    expect(courseVisible(course({ audience: 'CLIENTS', moduleKey: 'portal' }), client)).toBe(true);
    expect(courseVisible(course(), client)).toBe(false);
    expect(courseVisible(course({ audience: 'CLIENTS', moduleKey: 'portal' }), staff())).toBe(false);
    expect(courseVisible(course({ audience: 'CLIENTS', moduleKey: 'portal' }), admin)).toBe(false);
  });

  it('R2 groups: empty = everyone; any matching key is enough', () => {
    expect(courseVisible(course({ roleKeys: [] }), staff())).toBe(true);
    expect(courseVisible(course({ roleKeys: ['admins'] }), staff())).toBe(false);
    expect(courseVisible(course({ roleKeys: ['admins'] }), admin)).toBe(true);
    expect(courseVisible(course({ roleKeys: ['employees'] }), staff())).toBe(true);
    expect(courseVisible(course({ roleKeys: ['employees'] }), admin)).toBe(false);
    expect(courseVisible(course({ roleKeys: ['project-runners'] }), runner)).toBe(true);
    expect(courseVisible(course({ roleKeys: ['project-runners'] }), staff())).toBe(false);
    expect(courseVisible(course({ roleKeys: ['training-managers', 'admins'] }), tm)).toBe(true);
    // Clients' courses ignore the groups.
    expect(courseVisible(course({ audience: 'CLIENTS', roleKeys: ['admins'] }), client)).toBe(true);
  });

  it('R3 companies: members of one of them (administrators always); clients by their granted projects’ main companies', () => {
    expect(courseVisible(course({ companyIds: ['A'] }), staff({ companyIds: ['A', 'B'] }))).toBe(true);
    expect(courseVisible(course({ companyIds: ['C'] }), staff({ companyIds: ['A', 'B'] }))).toBe(false);
    expect(courseVisible(course({ companyIds: ['C'] }), admin)).toBe(true);
    expect(courseVisible(course({ audience: 'CLIENTS', companyIds: ['A'] }), client)).toBe(true);
    expect(courseVisible(course({ audience: 'CLIENTS', companyIds: ['B'] }), client)).toBe(false);
  });

  it('learning needs a published course', () => {
    expect(canLearn(course(), staff())).toBe(true);
    expect(canLearn(course({ status: 'DRAFT' }), staff())).toBe(false);
    expect(canLearn(course({ status: 'ARCHIVED' }), admin)).toBe(false);
  });
});

describe('R5 who manages and in what scope', () => {
  it('Training managers and administrators manage; never a client', () => {
    expect(isManager(admin)).toBe(true);
    expect(isManager(tm)).toBe(true);
    expect(isManager(runner)).toBe(false);
    expect(isManager(staff({ client: true, trainingManager: true }))).toBe(false);
  });

  it('reports: everyone for administrators, their companies for a Training manager, their team for whoever runs a project', () => {
    expect(reportScope(admin)).toBe('ALL');
    expect(reportScope(staff({ admin: true, trainingManager: true }))).toBe('ALL');
    expect(reportScope(tm)).toBe('COMPANIES');
    expect(reportScope(staff({ trainingManager: true, runsProject: true }))).toBe('COMPANIES');
    expect(reportScope(runner)).toBe('TEAM');
    expect(reportScope(staff())).toBeNull();
    expect(reportScope(client)).toBeNull();
  });

  it('a Training manager’s people share a company with them (null scope: everyone)', () => {
    expect(inScope(null, staff({ companyIds: ['Z'] }))).toBe(true);
    expect(inScope(['A'], staff({ companyIds: ['B', 'A'] }))).toBe(true);
    expect(inScope(['A'], staff({ companyIds: ['B'] }))).toBe(false);
    expect(inScope(['A'], staff({ companyIds: [] }))).toBe(false);
    expect(inScope(['A'], client)).toBe(true);
  });
});

describe('moduleShown', () => {
  const m = (o: Partial<{ moduleKey: string; roleKeys: string[]; companyIds: string[]; enabled: boolean }> = {}) => ({ moduleKey: 'tasks', roleKeys: [], companyIds: [], enabled: true, ...o });
  const b = staff({ companyIds: ['B'] });
  it('never more than the feature access', () => {
    for (const k of ['reports', 'admin']) {
      expect(moduleShown(m({ moduleKey: k }), admin)).toBe(true);
      for (const p of [staff(), runner, tm]) expect(moduleShown(m({ moduleKey: k }), p)).toBe(false);
    }
    expect(moduleShown(m({ moduleKey: 'management' }), admin)).toBe(true);
    expect(moduleShown(m({ moduleKey: 'management' }), runner)).toBe(true);
    expect(moduleShown(m({ moduleKey: 'management' }), staff())).toBe(false);
  });
  it('groups, companies and the switch', () => {
    expect(moduleShown(m({ roleKeys: ['training-managers'] }), tm)).toBe(true);
    expect(moduleShown(m({ roleKeys: ['training-managers'] }), staff())).toBe(false);
    expect(moduleShown(m({ companyIds: ['A'] }), b)).toBe(false);
    expect(moduleShown(m({ companyIds: ['A'] }), admin)).toBe(true);
    for (const p of [admin, staff(), runner, tm, client]) expect(moduleShown(m({ enabled: false }), p)).toBe(false);
  });
  it('a client (in a course for clients): on and their company — the feature and the groups don’t apply', () => {
    const clientB = staff({ client: true, companyIds: ['B'] });
    for (const k of ['portal', 'general', 'tasks', 'reports', 'admin', 'management']) expect(moduleShown(m({ moduleKey: k }), client)).toBe(true);
    expect(moduleShown(m({ roleKeys: ['admins'] }), client)).toBe(true);
    expect(moduleShown(m({ roleKeys: ['training-managers'] }), client)).toBe(true);
    expect(moduleShown(m({ companyIds: ['A'] }), client)).toBe(true);
    expect(moduleShown(m({ companyIds: ['A'] }), clientB)).toBe(false);
    expect(moduleShown(m({ enabled: false }), client)).toBe(false);
    // Staff are unchanged: the Client portal module is still not theirs.
    expect(moduleShown(m({ moduleKey: 'portal' }), staff())).toBe(false);
  });
});
