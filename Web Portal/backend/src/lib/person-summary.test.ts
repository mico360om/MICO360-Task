import { describe, it, expect } from 'vitest';
import { PERSON_SUMMARY_SELECT, personName, personSummary } from './person-summary';

// Avatar hotfix (owner, 10 Nov): one shape for "a person as a face shows them" — their name and photo.
describe('person summary', () => {
  it('selects the name parts and the photo, nothing else', () => {
    expect(PERSON_SUMMARY_SELECT).toEqual({ id: true, username: true, firstName: true, lastName: true, avatarUrl: true });
  });

  it('is their id, display name and photo path', () => {
    expect(personSummary({ id: 'u1', username: 'km', firstName: 'Khurram', lastName: 'Mian', avatarUrl: '/uploads/avatars/km.png' })).toEqual({
      id: 'u1',
      name: 'Khurram Mian',
      avatarUrl: '/uploads/avatars/km.png',
    });
  });

  it('no photo is null (the face shows the initials)', () => {
    expect(personSummary({ id: 'u2', username: 'omar', firstName: 'Omar', lastName: '', avatarUrl: null }).avatarUrl).toBeNull();
    expect(personSummary({ id: 'u2', username: 'omar', firstName: 'Omar', lastName: '', avatarUrl: undefined }).avatarUrl).toBeNull();
    expect(personSummary({ id: 'u2', username: 'omar', firstName: 'Omar', lastName: '', avatarUrl: '  ' }).avatarUrl).toBeNull();
  });

  it('the display name is first + last, else the username', () => {
    expect(personName({ username: 'omar', firstName: 'Omar', lastName: '' })).toBe('Omar');
    expect(personName({ username: 'omar', firstName: '', lastName: '' })).toBe('omar');
    expect(personName({ username: 'z', firstName: null, lastName: 'Malik' })).toBe('Malik');
    expect(personName({ username: 'pad', firstName: ' ', lastName: '' })).toBe('pad'); // blanks: the username
  });
});
