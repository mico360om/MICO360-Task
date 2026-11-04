import { describe, it, expect } from 'vitest';
import { boardPeople, facesOf, BOARD_ROLE_LABEL } from './board-people';
import type { ApiMember } from '../api/members';
import type { DirectoryUser } from '../api/users';

const member = (id: string, first: string, role: 'MEMBER' | 'MANAGER' = 'MEMBER', over: Partial<ApiMember> = {}): ApiMember => ({
  id, username: first.toLowerCase(), email: `${id}@x`, firstName: first, lastName: 'Test', role, ...over,
});
const person = (id: string, first: string, over: Partial<DirectoryUser> = {}): DirectoryUser => ({
  id, username: first.toLowerCase(), firstName: first, lastName: 'Test', avatarUrl: null, ...over,
});

describe('boardPeople — who can open a project’s board', () => {
  const directory = [
    person('own', 'Olivia', { avatarUrl: '/uploads/olivia.png' }),
    person('pm', 'Paul'),
    person('m1', 'Zara'),
    person('m2', 'Adam'),
    person('mgr', 'Mona'),
    person('gone', 'Gina', { active: false }),
    person('out', 'Omar'),
  ];

  it('owner first, then managers (the named manager first), then the team A–Z, each with face and role', () => {
    const people = boardPeople({ ownerId: 'own', managerId: 'pm' }, [member('m1', 'Zara'), member('m2', 'Adam'), member('mgr', 'Mona', 'MANAGER'), member('own', 'Olivia', 'MANAGER')], directory);
    expect(people.map((p) => [p.name, p.role])).toEqual([
      ['Olivia Test', 'OWNER'],
      ['Paul Test', 'MANAGER'],
      ['Mona Test', 'MANAGER'],
      ['Adam Test', 'MEMBER'],
      ['Zara Test', 'MEMBER'],
    ]);
    expect(people[0]!.avatarUrl).toBe('/uploads/olivia.png');
  });

  it('leaves out someone who can no longer open it (no access through its companies) and deactivated people', () => {
    const people = boardPeople({ ownerId: 'own', managerId: null }, [member('out', 'Omar', 'MEMBER', { hasAccess: false }), member('gone', 'Gina'), member('m1', 'Zara')], directory);
    expect(people.map((p) => p.id)).toEqual(['own', 'm1']);
  });

  it('an owner or manager on the team without access is left out too', () => {
    expect(boardPeople({ ownerId: 'out', managerId: null }, [member('out', 'Omar', 'MANAGER', { hasAccess: false })], directory)).toEqual([]);
  });

  it('a project without an owner, or one whose owner isn’t known here, just lists its team', () => {
    expect(boardPeople({ ownerId: null }, [member('m1', 'Zara')], directory).map((p) => p.id)).toEqual(['m1']);
    expect(boardPeople({ ownerId: 'stranger' }, [member('m1', 'Zara')], directory).map((p) => p.id)).toEqual(['m1']);
  });

  it('someone on the team but not in the directory keeps the team’s name for them', () => {
    expect(boardPeople({ ownerId: null }, [member('new', 'Nadia')], directory)).toEqual([{ id: 'new', name: 'Nadia Test', avatarUrl: null, role: 'MEMBER' }]);
  });

  it('skips rows it can’t read (no id, no name) instead of failing', () => {
    const odd = [{ id: 'p1', code: 'MICO', name: 'A project' }, { username: 'noid' }] as unknown as ApiMember[];
    expect(boardPeople({ ownerId: null }, odd, [])).toEqual([]);
  });

  it('names the roles in plain words', () => {
    expect(BOARD_ROLE_LABEL).toEqual({ OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Member' });
  });
});

describe('facesOf — up to so many faces, then “+N”', () => {
  const people = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P ${i}`, avatarUrl: null, role: 'MEMBER' as const }));
  it('eight on a wide screen, three on a phone', () => {
    expect(facesOf(people, 8)).toEqual({ shown: people.slice(0, 8), more: 4 });
    expect(facesOf(people, 3)).toEqual({ shown: people.slice(0, 3), more: 9 });
  });
  it('all of them when they fit', () => {
    expect(facesOf(people.slice(0, 8), 8)).toEqual({ shown: people.slice(0, 8), more: 0 });
    expect(facesOf([], 3)).toEqual({ shown: [], more: 0 });
  });
});
