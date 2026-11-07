import { describe, it, expect } from 'vitest';
import { grantRow, grantRows, grantOf, grantsSchema } from './client-grants';

const all = { comment: true, signOff: true, respond: true, download: true, upload: true, notify: true };

describe('Client project grants', () => {
  it('everything is off until ticked', () => {
    const [g] = grantsSchema.parse([{ projectId: 'p1', modules: { progress: true } }]);
    expect(grantRow(g!)).toEqual({ projectId: 'p1', role: 'CUSTOM', progress: true, meetings: false, canComment: false, canSignOff: false, canRespond: false, canDownload: false, canUpload: false, canNotify: false });
  });

  it('needs at least one module per project (400)', () => {
    const [g] = grantsSchema.parse([{ projectId: 'p1', actions: all }]);
    expect(() => grantRow(g!)).toThrow(/at least one of View tasks or View meetings/);
  });

  it('an action without its module is saved as off', () => {
    const progressOnly = grantRow({ projectId: 'p', role: 'CUSTOM', modules: { progress: true, meetings: false }, actions: all });
    expect(progressOnly).toMatchObject({ canComment: true, canSignOff: true, canRespond: false, canDownload: true });
    const meetingsOnly = grantRow({ projectId: 'p', role: 'CUSTOM', modules: { progress: false, meetings: true }, actions: all });
    expect(meetingsOnly).toMatchObject({ canComment: false, canSignOff: false, canRespond: true, canDownload: true });
  });

  it('lists each project once', () => {
    const g = { projectId: 'p1', role: 'CUSTOM' as const, modules: { progress: true, meetings: false }, actions: { comment: false, signOff: false, respond: false, download: false, upload: false, notify: false } };
    expect(() => grantRows([g, g])).toThrow(/once/);
  });

  it('a stored row reads back in the same shape', () => {
    const g = { projectId: 'p1', role: 'CUSTOM' as const, modules: { progress: true, meetings: true }, actions: all };
    expect(grantOf(grantRow(g))).toEqual(g);
  });

  it('only booleans are ticks (anything else is a 400 from the schema)', () => {
    expect(() => grantsSchema.parse([{ projectId: 'p1', modules: { progress: 'yes' } }])).toThrow();
  });
});
