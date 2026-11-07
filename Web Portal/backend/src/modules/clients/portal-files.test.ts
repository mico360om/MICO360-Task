import { describe, it, expect } from 'vitest';
import { actionsOf, portalFiles, portalTaskView, type PortalFileSource, type PortalTaskSource } from './portal-payload';
import type { GrantRow } from './client-grants';

// 1.23.7: uploads, files and notifications in the Client portal's answers (allow-lists).
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-07T08:00:00Z');
const grant = (over: Partial<GrantRow> = {}): GrantRow => ({ projectId: 'p1', role: 'CUSTOM', progress: true, meetings: false, canComment: false, canSignOff: false, canRespond: false, canDownload: false, canUpload: false, canNotify: false, ...over });
const task: PortalTaskSource = {
  id: 't1', key: 'RIG-4', title: 'Install pump', description: null, isMilestone: false, clientVisible: true, clientShowDescription: false,
  columnCategory: 'IN_PROGRESS', completedAt: null, dueDate: null, approvalRequestedAt: null, clientAcceptedAt: null,
};
const file = (over: Partial<PortalFileSource> & Record<string, unknown> = {}): PortalFileSource =>
  ({
    id: 'f1', filename: 'Pump spec.pdf', mimeType: 'application/pdf', sizeBytes: 2048, createdAt: new Date('2026-11-06T09:00:00Z'),
    uploadedById: 'u-omar', fromClient: false, clientVisible: true,
    // What a row may also carry never reaches a client.
    storageKey: 'secret-key.pdf', url: '/uploads/secret-key.pdf', uploadedBy: { firstName: 'Omar' },
    ...over,
  }) as PortalFileSource;

describe('the upload and notify permissions in the portal', () => {
  it('upload needs View tasks; notifications need a module', () => {
    expect(actionsOf(grant({ canUpload: true }))).toMatchObject({ upload: true });
    expect(actionsOf(grant({ progress: false, meetings: true, canUpload: true }))).toMatchObject({ upload: false });
    expect(actionsOf(grant({ canNotify: true }))).toMatchObject({ notify: true });
    expect(actionsOf(grant({ progress: false, meetings: false, canNotify: true }))).toMatchObject({ notify: false });
  });
});

describe('a shared task’s files, as a client sees them', () => {
  it('only files shown to clients and the client’s own uploads — never another client’s unshown upload or a staff file', () => {
    const rows = [
      file({ id: 'shown' }),
      file({ id: 'staff-only', clientVisible: false }),
      file({ id: 'mine', uploadedById: 'c1', fromClient: true, clientVisible: false }),
      file({ id: 'other-client', uploadedById: 'c2', fromClient: true, clientVisible: false }),
      file({ id: 'other-client-shown', uploadedById: 'c2', fromClient: true, clientVisible: true }),
      // A staff file with the client's id can't pass as theirs (only fromClient rows are "yours").
      file({ id: 'spoofed', uploadedById: 'c1', fromClient: false, clientVisible: false }),
    ];
    const out = portalFiles(rows, 'c1');
    expect(out.map((f) => [f.id, f.from])).toEqual([
      ['shown', 'team'],
      ['mine', 'you'],
      ['other-client-shown', 'team'],
    ]);
    expect(out[0]).toEqual({ id: 'shown', name: 'Pump spec.pdf', type: 'application/pdf', sizeBytes: 2048, addedAt: '2026-11-06T09:00:00.000Z', from: 'team' });
    expect(JSON.stringify(out)).not.toMatch(/secret-key|uploads|Omar|u-omar|c2/);
  });

  it('the task view carries the files and "can upload" only with the Upload permission', () => {
    const without = portalTaskView(task, grant(), null, 'c1', TZ, NOW, [file()]);
    expect(without.files.map((f) => f.id)).toEqual(['f1']);
    expect(without.can).toEqual({ comment: false, signOff: false, upload: false });
    expect(portalTaskView(task, grant({ canUpload: true }), null, 'c1', TZ, NOW, []).can.upload).toBe(true);
  });
});
