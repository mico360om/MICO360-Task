import { describe, it, expect } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  accountRoleLabel,
  avatarHref,
  avatarPart,
  avatarProblem,
  isPickedCopy,
  fullNameOf,
  initialsOf,
  myDataFileName,
  myDataProblem,
  photoOf,
  photoRemoveProblem,
  photoUploadProblem,
  withAvatar,
  withDirectoryUser,
} from './account';
import { ApiError, NetworkError } from './api-client';
import type { Session } from './types';

describe('account: who you are, as the website shows it', () => {
  it('labels the role as the website does: Administrator wins, everyone else is an Employee', () => {
    expect(accountRoleLabel(['ADMIN'])).toBe('Administrator');
    expect(accountRoleLabel(['EMPLOYEE', 'ADMIN'])).toBe('Administrator');
    expect(accountRoleLabel(['EMPLOYEE'])).toBe('Employee');
    expect(accountRoleLabel([])).toBe('Employee');
    expect(accountRoleLabel(undefined)).toBe('Employee');
  });

  it('shows the full name from the directory, else the username', () => {
    expect(fullNameOf({ firstName: 'Ada', lastName: 'Lovelace', username: 'ada' }, 'ada')).toBe('Ada Lovelace');
    expect(fullNameOf({ firstName: ' ', lastName: '', username: 'ada' }, 'ada')).toBe('ada');
    expect(fullNameOf(undefined, 'ada')).toBe('ada');
    expect(fullNameOf(undefined, undefined)).toBe('—');
  });

  it('makes initials the way the website does (the first two letters)', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AD');
    expect(initialsOf('')).toBe('?');
  });
});

describe('account: the profile photo', () => {
  it('offers only the picture types the server takes', () => {
    expect(AVATAR_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  });

  it('sends a picked picture as the multipart part, typed by its name when the picker doesn’t say', () => {
    expect(avatarPart({ uri: 'file:///cache/me.JPG', name: 'me.JPG', mimeType: null })).toEqual({ uri: 'file:///cache/me.JPG', name: 'me.JPG', type: 'image/jpeg' });
    expect(avatarPart({ uri: 'content://x/42', name: '', mimeType: 'image/png' })).toEqual({ uri: 'content://x/42', name: 'photo.png', type: 'image/png' });
    expect(avatarPart({ uri: 'content://x/43', name: undefined, mimeType: undefined })).toEqual({ uri: 'content://x/43', name: 'photo.jpg', type: 'image/jpeg' });
  });

  it('opens the photo from the API server’s origin, or shows none', () => {
    expect(avatarHref('https://task.mico360.com/api/v1', '/uploads/a.png')).toBe('https://task.mico360.com/uploads/a.png');
    expect(avatarHref('https://task.mico360.com/api/v1', null)).toBeNull();
    expect(avatarHref('https://task.mico360.com/api/v1', undefined)).toBeNull();
  });

  it('shows a photo only from this server’s uploads (6a review)', () => {
    const api = 'https://task.mico360.com/api/v1';
    expect(avatarHref(api, 'https://tracker.example/pixel.png')).toBeNull();
    expect(avatarHref(api, 'http://task.mico360.com/uploads/a.png')).toBeNull();
    expect(avatarHref(api, '//tracker.example/uploads/a.png')).toBeNull();
    expect(avatarHref(api, 'data:image/png;base64,AAAA')).toBeNull();
    expect(avatarHref(api, '/elsewhere/a.png')).toBeNull();
  });

  it('checks a picked picture before sending it: the server’s types, and up to the server’s 10 MB (6a review)', () => {
    expect(AVATAR_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(avatarProblem({ name: 'me.jpg', mimeType: 'image/jpeg', size: 2_000_000 })).toBeNull();
    expect(avatarProblem({ name: 'me.jpg', mimeType: 'image/jpeg', size: undefined })).toBeNull();
    expect(avatarProblem({ name: 'big.jpg', mimeType: 'image/jpeg', size: 12 * 1024 * 1024 })).toBe('That picture is too large. Choose a smaller one.');
    expect(avatarProblem({ name: 'me.heic', mimeType: 'image/heic', size: 1000 })).toBe('“me.heic” can’t be used — choose a PNG, JPEG, WebP or GIF image.');
  });

  it('knows which files are the picker’s own copies (deleted after use), never the person’s originals (6a review)', () => {
    const cache = 'file:///data/user/0/com.mico360.tasks/cache/';
    expect(isPickedCopy(`${cache}DocumentPicker/1b2c-me.jpg`, cache)).toBe(true);
    expect(isPickedCopy('content://com.android.providers.media.documents/document/image%3A12', cache)).toBe(false);
    expect(isPickedCopy('file:///sdcard/DCIM/me.jpg', cache)).toBe(false);
    expect(isPickedCopy(`${cache}DocumentPicker/../exports/r.xlsx`, cache)).toBe(false);
    expect(isPickedCopy(`${cache}DocumentPicker/x.jpg`, null)).toBe(false);
  });

  it('says why a picture wasn’t taken, in the website’s words', () => {
    expect(photoUploadProblem(new ApiError(413, 'ERROR', 'Request failed (413)'))).toBe('That picture is too large. Choose a smaller one.');
    expect(photoUploadProblem(new ApiError(400, 'VALIDATION', 'Image content does not match its declared type.'))).toBe(
      'That file isn’t a real picture — it may be damaged or renamed. Choose a PNG, JPEG, WebP or GIF image.',
    );
    expect(photoUploadProblem(new ApiError(400, 'VALIDATION', 'Images can be up to 5 MB; this one is 7.3 MB.'))).toBe('Images can be up to 5 MB; this one is 7.3 MB.');
    expect(photoUploadProblem(new ApiError(400, 'ERROR', 'Request failed (400)'))).toBe('Couldn’t upload the photo. Please try again.');
    expect(photoUploadProblem(new ApiError(500, 'INTERNAL', 'Something went wrong.'))).toBe('Couldn’t upload the photo. Please try again.');
    expect(photoUploadProblem(new Error('boom'))).toBe('Couldn’t upload the photo. Please try again.');
  });

  it('says plainly when the phone is offline or the upload ran out of time', () => {
    expect(photoUploadProblem(new NetworkError('Network request failed.'))).toBe('You’re offline — your photo can be changed when you’re connected.');
    expect(photoUploadProblem(new NetworkError('slow', { timedOut: true }))).toBe('The upload took too long. Check your connection and try again.');
    expect(photoRemoveProblem(new NetworkError('Network request failed.'))).toBe('You’re offline — your photo can be removed when you’re connected.');
    expect(photoRemoveProblem(new ApiError(500, 'INTERNAL', 'x'))).toBe('Couldn’t remove the photo. Please try again.');
  });

  it('keeps the session’s tokens and changes only the photo', () => {
    const s: Session = { user: { id: 'u1', email: 'a@x.test', username: 'ada', roles: ['EMPLOYEE'], avatarUrl: null }, accessToken: 'fake-a', refreshToken: 'fake-r' };
    expect(withAvatar(s, '/uploads/new.png')).toEqual({ ...s, user: { ...s.user, avatarUrl: '/uploads/new.png' } });
    expect(withAvatar(s, null).user.avatarUrl).toBeNull();
  });

  it('puts the new photo into the people list at once (others are left alone)', () => {
    const list = [
      { id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'L', avatarUrl: null },
      { id: 'u2', username: 'bo', firstName: 'Bo', lastName: 'K', avatarUrl: '/uploads/bo.png' },
    ];
    const next = withDirectoryUser(list, { id: 'u1', avatarUrl: '/uploads/ada.png' });
    expect(next?.[0]).toEqual({ ...list[0], avatarUrl: '/uploads/ada.png' });
    expect(next?.[1]).toBe(list[1]);
    expect(withDirectoryUser(undefined, { id: 'u1', avatarUrl: null })).toBeUndefined();
  });
});

describe('account: Download my data', () => {
  it('names the file as the website does (the server’s own name wins when it gives one)', () => {
    expect(myDataFileName('2026-10-21')).toBe('mico360-my-data-2026-10-21.json');
  });

  it('says plainly when it can’t be prepared, or the phone is offline', () => {
    expect(myDataProblem(new NetworkError('Couldn’t download the file — check your connection.'))).toBe('You’re offline — your data can be downloaded when you’re connected.');
    expect(myDataProblem(new ApiError(404, 'ERROR', 'Export failed (404)'))).toBe('Couldn’t prepare your data. Please try again.');
    expect(myDataProblem(new Error('Sharing is not available on this device.'))).toBe('Sharing is not available on this device.');
  });
});

describe('account: which photo to show', () => {
  it('the people list’s when it has you (it is the newest), else the session’s', () => {
    expect(photoOf({ id: 'u1', avatarUrl: '/uploads/new.png' }, { avatarUrl: '/uploads/old.png' })).toBe('/uploads/new.png');
    expect(photoOf({ id: 'u1', avatarUrl: null }, { avatarUrl: '/uploads/old.png' })).toBeNull();
    expect(photoOf({ id: 'u1' }, { avatarUrl: '/uploads/old.png' })).toBe('/uploads/old.png');
    expect(photoOf(undefined, { avatarUrl: '/uploads/old.png' })).toBe('/uploads/old.png');
    expect(photoOf(undefined, undefined)).toBeNull();
  });
});
