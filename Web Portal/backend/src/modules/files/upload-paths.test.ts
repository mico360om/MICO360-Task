import { describe, expect, it } from 'vitest';
import { UPLOAD_TYPES, buildUploadKey, newFormKey, parseUploadKey, refiledKey, uuidNameFor, type UploadType } from './upload-paths';

const UUID = '1b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10';
const AT = new Date('2026-03-07T23:30:00Z');

describe('buildUploadKey', () => {
  it.each(UPLOAD_TYPES.map((t) => [t]))('builds <company>/<YYYY>/<MM>/<person>/%s/<uuid>.<ext>', (type) => {
    const key = buildUploadKey({ companyId: 'ckcompany1', userId: 'ckuser1', type: type as UploadType, at: AT, ext: '.png' }, UUID);
    expect(key).toBe(`ckcompany1/2026/03/ckuser1/${type}/${UUID}.png`);
    expect(parseUploadKey(key)).toMatchObject({ key, legacy: false, companyId: 'ckcompany1', type });
  });

  it('uses shared for no company, system for no person, the UTC month and a random uuid', () => {
    const key = buildUploadKey({ companyId: null, userId: null, type: 'profile-photos', at: new Date('2026-12-31T23:59:59Z'), ext: '.jpg' });
    expect(key).toMatch(/^shared\/2026\/12\/system\/profile-photos\/[0-9a-f-]{36}\.jpg$/);
    expect(parseUploadKey(key)?.companyId).toBeNull();
  });

  it('refuses ids that are not plain database ids, and an odd extension', () => {
    for (const bad of ['../x', 'a/b', 'a\\b', '', 'a b', 'a%2e', 'x'.repeat(65), 'shared', 'faces']) {
      expect(() => buildUploadKey({ companyId: bad, userId: 'u1', type: 'task-files', at: AT, ext: '' })).toThrow();
    }
    expect(() => buildUploadKey({ companyId: 'c1', userId: '../u', type: 'task-files', at: AT, ext: '' })).toThrow();
    expect(() => buildUploadKey({ companyId: 'c1', userId: 'u1', type: 'nope' as UploadType, at: AT, ext: '' })).toThrow();
    expect(() => buildUploadKey({ companyId: 'c1', userId: 'u1', type: 'task-files', at: AT, ext: '.ht/ml' })).toThrow();
  });
});

describe('parseUploadKey', () => {
  it('accepts the 1.23.31 names (a uuid and an extension)', () => {
    expect(parseUploadKey(`${UUID}.pdf`)).toEqual({ key: `${UUID}.pdf`, legacy: true, companyId: null, type: null, name: `${UUID}.pdf` });
    expect(parseUploadKey(UUID)?.legacy).toBe(true);
  });

  it('refuses .., backslashes, NUL, %, odd characters, wrong shapes and long names', () => {
    const bad = [
      '',
      '..',
      `../${UUID}.png`,
      `c1/2026/03/u1/task-files/../${UUID}.png`,
      `c1/2026/03/u1/task-files/${UUID}.png/..`,
      `c1\\2026\\03\\u1\\task-files\\${UUID}.png`,
      `c1/2026/03/u1/task-files/${UUID}.png\0`,
      `c1/2026/03/u1/task-files/${UUID}%2epng`,
      `c1/2026/13/u1/task-files/${UUID}.png`,
      `c1/2026/00/u1/task-files/${UUID}.png`,
      `c1/26/03/u1/task-files/${UUID}.png`,
      `c1/2026/03/u1/other/${UUID}.png`,
      `c1/2026/03/u1/task-files/notauuid.png`,
      `c1/2026/03/task-files/${UUID}.png`,
      `/c1/2026/03/u1/task-files/${UUID}.png`,
      `c1//2026/03/u1/task-files/${UUID}.png`,
      `c1/2026/03/u1/task-files/${UUID}.p ng`,
      `c 1/2026/03/u1/task-files/${UUID}.png`,
      `faces/2026/03/u1/task-files/${UUID}.png`,
      `c1/2026/03/u1/task-files/${UUID}.png?x`,
      `${'a'.repeat(190)}/2026/03/u1/task-files/${UUID}.png`,
      `.${UUID}.png`,
      `${UUID}.p/ng`,
      123,
      null,
    ];
    for (const raw of bad) expect(parseUploadKey(raw as string), String(raw)).toBeNull();
  });
});

describe('moving names', () => {
  it('newFormKey keeps the old uuid and a clean extension (deterministic)', () => {
    const a = newFormKey(`${UUID}.PNG`, { companyId: 'c1', userId: 'u1', type: 'task-files', at: AT, mimeType: 'image/png' });
    expect(a).toBe(`c1/2026/03/u1/task-files/${UUID}.PNG`);
    expect(newFormKey(`${UUID}.PNG`, { companyId: 'c1', userId: 'u1', type: 'task-files', at: AT, mimeType: 'image/png' })).toBe(a);
  });

  it('an odd old extension is replaced by the checked type’s; an odd old name gets a uuid from its hash', () => {
    expect(newFormKey(`${UUID}.my file.docx`, { companyId: null, userId: 'u1', type: 'task-files', at: AT, mimeType: 'application/pdf' })).toBe(`shared/2026/03/u1/task-files/${UUID}.pdf`);
    const odd = uuidNameFor('report final.pdf');
    expect(odd).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(uuidNameFor('report final.pdf')).toBe(odd);
  });

  it('refiledKey swaps only the company', () => {
    expect(refiledKey(`c1/2026/03/u1/task-files/${UUID}.png`, 'c2')).toBe(`c2/2026/03/u1/task-files/${UUID}.png`);
    expect(refiledKey(`c1/2026/03/u1/task-files/${UUID}.png`, null)).toBe(`shared/2026/03/u1/task-files/${UUID}.png`);
    expect(refiledKey(`${UUID}.png`, 'c2')).toBeNull();
  });
});

// Review (1.23.39): v0.1.0 names kept the uploader's own extension, spaces and all; the folder parts are
// matched case-sensitively, so SHARED/… or FACES/… is never a company.
describe('review fixes', () => {
  it('still accepts a v0.1.0 name with a space in its extension', () => {
    expect(parseUploadKey(`${UUID}.my file.docx`)?.legacy).toBe(true);
    expect(parseUploadKey(`${UUID}.my file/../x`)).toBeNull();
  });
  it('folder parts are case-sensitive', () => {
    // Reserved top folders in any case are refused (Windows folders ignore case).
    expect(parseUploadKey(`SHARED/2026/03/u1/task-files/${UUID}.png`)).toBeNull();
    expect(parseUploadKey(`FACES/2026/03/u1/task-files/${UUID}.png`)).toBeNull();
    expect(parseUploadKey(`Downloads/2026/03/u1/task-files/${UUID}.png`)).toBeNull();
    expect(parseUploadKey(`c1/2026/03/u1/TASK-FILES/${UUID}.png`)).toBeNull();
    expect(parseUploadKey(`c1/2026/03/u1/task-files/${UUID.toUpperCase()}.png`)).toBeNull();
  });
});
