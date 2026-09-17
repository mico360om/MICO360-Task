import { describe, it, expect } from 'vitest';
import { searchAll, type SearchData } from './search-service';

const data: SearchData = {
  tasks: [],
  projects: [],
  users: [],
  meetings: [
    { id: 'm1', title: 'Q4 Planning', projectId: 'p1', organizerId: 'u1', attendeeUserIds: ['u2'], content: 'Decided to adopt a new pricing tier for enterprise. Draft the OKRs.' },
    { id: 'm2', title: 'Design Review', projectId: 'p2', organizerId: 'u3', attendeeUserIds: [], content: 'Discussed the pricing page layout and accessibility.' },
    { id: 'm3', title: 'Personal 1:1', projectId: null, organizerId: 'u2', attendeeUserIds: ['u9'], content: 'Career goals and feedback.' },
  ],
};

describe('searchAll — meeting knowledge base', () => {
  it('matches on title and on content (agenda/notes/decisions)', () => {
    const byTitle = searchAll('planning', data);
    expect(byTitle.meetings.map((m) => m.id)).toEqual(['m1']);
    const byContent = searchAll('pricing', data);
    expect(byContent.meetings.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('returns a snippet centered on the match, truncated with an ellipsis for long content', () => {
    const res = searchAll('pricing', data);
    expect(res.meetings.find((m) => m.id === 'm1')!.snippet.toLowerCase()).toContain('pricing');
    // long content → windowed excerpt with ellipses around the match
    const long: SearchData = { tasks: [], projects: [], users: [], meetings: [
      { id: 'x', title: 'Long', projectId: null, organizerId: 'u1', attendeeUserIds: [], content: `${'lorem ipsum '.repeat(20)} the KEYWORD is here ${'dolor sit '.repeat(20)}` },
    ] };
    const snip = searchAll('keyword', long).meetings[0]!.snippet;
    expect(snip.toLowerCase()).toContain('keyword');
    expect(snip.startsWith('…') && snip.endsWith('…')).toBe(true);
    expect(snip.length).toBeLessThan(180);
  });

  it('scopes project meetings to accessible projects for a non-admin', () => {
    // member of p1 only, userId u5 (organizes/attends nothing)
    const res = searchAll('pricing', data, { allowedProjectIds: ['p1'], userId: 'u5' });
    expect(res.meetings.map((m) => m.id)).toEqual(['m1']); // m2 (p2) excluded
  });

  it('lets a non-member still find a standalone meeting they organize or attend', () => {
    // u2 organizes m3 (standalone) and attends m1; but has no project access
    const res = searchAll('goals', data, { allowedProjectIds: [], userId: 'u2' });
    expect(res.meetings.map((m) => m.id)).toEqual(['m3']);
  });

  it('an admin (null scope) finds everything', () => {
    const res = searchAll('pricing', data, { allowedProjectIds: null });
    expect(res.meetings.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('excludes a private meeting from an unrelated user', () => {
    // u7 has no project access and neither organizes nor attends anything
    const res = searchAll('career', data, { allowedProjectIds: [], userId: 'u7' });
    expect(res.meetings).toHaveLength(0);
  });
});
