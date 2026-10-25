import { describe, it, expect } from 'vitest';
import { matchPerson, matchProject, personOption, projectOption } from './mico-ai-resolve';
import type { AiPersonRec, AiProjectRec } from './mico-ai-data';

const project = (id: string, code: string, name: string, number: string | null = null): AiProjectRec => ({
  id, code, number, name, status: 'ACTIVE', clientName: null, description: null, startDate: null, targetDate: null, managerId: null, ownerId: null,
});
const person = (id: string, firstName: string, lastName: string, username: string, active = true): AiPersonRec => ({ id, firstName, lastName, username, active });

const projects = [project('p-rig', 'RIG', 'Rig Inspection Portal', 'J-104'), project('p-rig2', 'RIG2', 'Rig Maintenance'), project('p-fal', 'FAL', 'Falcon CRM')];
const people = [person('u1', 'Omar', 'Said', 'omar'), person('u2', 'Omar', 'Khan', 'omar.k'), person('u3', 'Sara', 'Ahmed', 'sara'), person('u4', 'سارة', 'البلوشي', 'sara.b')];

describe('MICO AI: names and projects to records, never a guess', () => {
  it('finds a project by its code, number or name — exact first', () => {
    expect(matchProject(projects, 'rig')).toEqual({ found: projects[0] });
    expect(matchProject(projects, 'J-104')).toEqual({ found: projects[0] });
    expect(matchProject(projects, 'Falcon CRM')).toEqual({ found: projects[2] });
  });

  it('a part of a name that fits several projects is "several", with them all', () => {
    expect(matchProject(projects, 'Rig ')).toEqual({ found: projects[0] }); // the code, exactly
    const out = matchProject(projects, 'rig m');
    expect(out).toEqual({ found: projects[1] });
    expect(matchProject(projects, 'ri')).toEqual({ several: [projects[0], projects[1]] });
    expect(matchProject(projects, 'Nothing like it')).toEqual({ none: true });
  });

  it('reads back its own quick-reply wording: "Rig Inspection Portal (RIG)"', () => {
    expect(matchProject(projects, projectOption(projects[0]!))).toEqual({ found: projects[0] });
    expect(projectOption(projects[0]!)).toBe('Rig Inspection Portal (RIG)');
  });

  it('finds a person by username, first name, last name or full name; "me" is the person asking', () => {
    expect(matchPerson(people, 'sara', 'u1')).toEqual({ found: people[2] });
    expect(matchPerson(people, 'Omar Khan', 'u1')).toEqual({ found: people[1] });
    expect(matchPerson(people, 'me', 'u3')).toEqual({ found: people[2] });
    expect(matchPerson(people, 'Myself', 'u2')).toEqual({ found: people[1] });
  });

  it('two Omars: "several" (the caller asks which one)', () => {
    expect(matchPerson(people, 'Omar', 'u3')).toEqual({ several: [people[0], people[1]] });
    expect(matchPerson(people, 'Zed', 'u3')).toEqual({ none: true });
  });

  it('reads back "Omar Khan (omar.k)", and Arabic names match as written', () => {
    expect(personOption(people[1]!)).toBe('Omar Khan (omar.k)');
    expect(matchPerson(people, 'Omar Khan (omar.k)', 'u3')).toEqual({ found: people[1] });
    expect(matchPerson(people, 'omar (omar)', 'u3')).toEqual({ found: people[0] });
    expect(matchPerson(people, 'سارة', 'u1')).toEqual({ found: people[3] });
  });
});
