import { describe, it, expect } from 'vitest';
import { CLIENT_ROLE_SETS, grantOf, grantRow, grantRows, grantsSchema, grantWords, roleOf, type ClientGrant } from './client-grants';

// 1.23.7 Granular Client Portal permissions: a role ladder (Viewer → Contributor → Approver) or Custom ticks,
// with two new permissions (upload documents, receive notifications).
const NONE = { comment: false, signOff: false, respond: false, download: false, upload: false, notify: false };
const ALL = { comment: true, signOff: true, respond: true, download: true, upload: true, notify: true };
const parse = (g: unknown) => grantsSchema.parse([g])[0]! as ClientGrant;

describe('client roles (a ladder)', () => {
  it('Viewer: view tasks and meetings, download reports, receive notifications', () => {
    expect(CLIENT_ROLE_SETS.VIEWER).toEqual({ modules: { progress: true, meetings: true }, actions: { ...NONE, download: true, notify: true } });
  });

  it('Contributor: Viewer + comment, upload documents, reply to invites', () => {
    expect(CLIENT_ROLE_SETS.CONTRIBUTOR).toEqual({ modules: { progress: true, meetings: true }, actions: { ...NONE, download: true, notify: true, comment: true, upload: true, respond: true } });
  });

  it('Approver: Contributor + sign off', () => {
    expect(CLIENT_ROLE_SETS.APPROVER).toEqual({ modules: { progress: true, meetings: true }, actions: ALL });
  });

  it('a role decides the ticks on the server: what was sent with it is not used', () => {
    const r = grantRow(parse({ projectId: 'p1', role: 'VIEWER', modules: { progress: false, meetings: false }, actions: { signOff: true, upload: true } }));
    expect(r).toEqual({ projectId: 'p1', role: 'VIEWER', progress: true, meetings: true, canComment: false, canSignOff: false, canRespond: false, canDownload: true, canUpload: false, canNotify: true });
    expect(grantRow(parse({ projectId: 'p1', role: 'APPROVER' }))).toMatchObject({ role: 'APPROVER', canSignOff: true, canUpload: true, canNotify: true });
  });

  it('Custom keeps the ticks as sent (each closed by its module), and is the default when no role is sent', () => {
    const r = grantRow(parse({ projectId: 'p1', modules: { progress: true }, actions: { upload: true, notify: true, respond: true } }));
    expect(r).toMatchObject({ role: 'CUSTOM', progress: true, meetings: false, canUpload: true, canNotify: true, canRespond: false });
  });

  it('upload needs View tasks; notifications need a module; Custom needs at least one module (400)', () => {
    const meetingsOnly = grantRow(parse({ projectId: 'p', role: 'CUSTOM', modules: { meetings: true }, actions: ALL }));
    expect(meetingsOnly).toMatchObject({ canUpload: false, canComment: false, canSignOff: false, canRespond: true, canDownload: true, canNotify: true });
    expect(() => grantRow(parse({ projectId: 'p', role: 'CUSTOM', actions: ALL }))).toThrow(/at least one/);
  });

  it('an unknown role or a non-boolean tick is a 400 from the schema', () => {
    expect(() => parse({ projectId: 'p', role: 'OWNER' })).toThrow();
    expect(() => parse({ projectId: 'p', role: 'CUSTOM', modules: { progress: true }, actions: { upload: 'yes' } })).toThrow();
  });

  it('a stored row reads back with its role; a grant from before 1.23.7 (no role yet) reads as Custom', () => {
    const g = { projectId: 'p1', role: 'CONTRIBUTOR' as const, ...CLIENT_ROLE_SETS.CONTRIBUTOR };
    expect(grantOf(grantRow(g))).toEqual(g);
    const old = { projectId: 'p1', role: null, progress: true, meetings: false, canComment: true, canSignOff: false, canRespond: false, canDownload: false, canUpload: false, canNotify: false };
    expect(roleOf(old)).toBe('CUSTOM');
    expect(grantOf(old).role).toBe('CUSTOM');
  });

  it('a whole list: each project once, each with its own role', () => {
    const rows = grantRows([parse({ projectId: 'a', role: 'VIEWER' }), parse({ projectId: 'b', role: 'APPROVER' })]);
    expect(rows.map((r) => r.role)).toEqual(['VIEWER', 'APPROVER']);
    expect(() => grantRows([parse({ projectId: 'a', role: 'VIEWER' }), parse({ projectId: 'a', role: 'VIEWER' })])).toThrow(/once/);
  });

  it('the plain words name the role and each permission (the audit log, "Clients with access")', () => {
    expect(grantWords(grantRow(parse({ projectId: 'p', role: 'APPROVER' })))).toEqual([
      'Approver',
      'View tasks',
      'View meetings & minutes',
      'Download reports',
      'Receive notifications',
      'Comment',
      'Upload documents',
      'Reply to invites',
      'Sign off',
    ]);
    expect(grantWords(grantRow(parse({ projectId: 'p', modules: { meetings: true }, actions: { respond: true } })))).toEqual(['Custom', 'View meetings & minutes', 'Reply to invites']);
  });
});
