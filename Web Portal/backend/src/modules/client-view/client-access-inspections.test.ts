import { describe, it, expect, beforeEach } from 'vitest';
import { createClientAccessService, type ClientAccessService } from './client-access-service';
import { createMemoryClientShareStore } from './client-share-store';
import { createMemoryClientViewSource } from './memory-client-view-source';
import { ClientSignInRequiredError } from './client-view-errors';
import { inspectPdf } from '../../lib/pdf-inspect';
import type { ClientInspection } from '../inspections/inspection-client-copy';
import type { ClientCodeParams, ClientInvitationParams } from '../email/email-templates';

// The client page's inspections: only finished reports someone who runs the project marked "Show to
// client" (the inspections module's list decides which), their PDF only through a signed-in device.

const report = (id: string, title: string): ClientInspection => ({
  id,
  title,
  date: '2026-10-27',
  place: 'Rig 3',
  counts: { total: 2, passed: 1, failed: 1, na: 0 },
  result: '1 failed',
  sections: [{ title: 'Deck', items: [{ label: 'Guard rails fitted', kind: 'CHECK', result: 'Fail', reading: null, limits: null, note: 'One rail loose' }, { label: 'Pressure', kind: 'READING', result: 'Pass', reading: '120.5 psi', limits: '0–150 psi', note: null }] }],
  signatures: [{ role: 'Inspector', name: 'Ivan Inspector', signedAt: '2026-10-27T08:30:00.000Z', image: null, typed: true }],
  unsigned: ['Client'],
});

let svc: ClientAccessService;
let invitations: { params: ClientInvitationParams }[];
let codes: { params: ClientCodeParams }[];
let pending: Promise<void>[];
const shown: Record<string, ClientInspection[]> = {};

beforeEach(() => {
  const source = createMemoryClientViewSource();
  source.addProject('p1', { name: 'Rig 7 Inspection', code: 'RIG', number: null, clientName: 'Oman Drilling Co.', status: 'ACTIVE', color: '#1E6B8B', icon: null, imageUrl: null, startDate: null, targetDate: null });
  source.addProject('p2', { name: 'Secret Other Project', code: 'SOP', number: null, clientName: null, status: 'ACTIVE', color: '#000000', icon: null, imageUrl: null, startDate: null, targetDate: null });
  shown.p1 = [report('i-shown', 'Rig daily check')];
  shown.p2 = [report('i-other', 'Other project’s inspection')];
  invitations = [];
  codes = [];
  pending = [];
  svc = createClientAccessService({
    store: createMemoryClientShareStore(),
    source,
    mailer: {
      isConfigured: () => true,
      sendClientInvitation: async (_e, params) => (invitations.push({ params }), 'sent'),
      sendClientCode: async (_e, params) => void codes.push({ params }),
    },
    userName: async () => 'Omar Ahmed',
    appUrl: 'https://task.mico360.test',
    assetUrl: 'https://task.mico360.test',
    timeZone: 'Asia/Muscat',
    runInBackground: (task) => void pending.push(task()),
    inspections: {
      list: async (projectId) => shown[projectId] ?? [],
      one: async (projectId, id) => (shown[projectId] ?? []).find((x) => x.id === id) ?? null,
    },
  });
});

async function signedIn() {
  await svc.share({ projectId: 'p1', name: 'Fatma', email: 'fatma@client.example', actorId: 'u-omar' });
  const link = /\/client\/([A-Za-z0-9_-]{43})$/.exec(invitations.at(-1)!.params.link)![1]!;
  await svc.requestCode(link, 'fatma@client.example', {});
  while (pending.length) await Promise.all(pending.splice(0));
  const { token } = await svc.verifyCode(link, 'fatma@client.example', codes.at(-1)!.params.code, {});
  return { link, session: () => token };
}

describe('inspections on the client page', () => {
  it('lists the project’s shown reports, with their signatures, and nothing of another project', async () => {
    const { link, session } = await signedIn();
    const view = await svc.view(link, session);
    expect(view.inspections).toEqual([report('i-shown', 'Rig daily check')]);
    expect(JSON.stringify(view)).not.toContain('Other project');
  });

  it('gives the PDF of a shown report: the client copy, no staff extras', async () => {
    const { link, session } = await signedIn();
    const { pdf, fileName } = await svc.inspectionPdf(link, session, 'i-shown');
    expect(fileName).toBe('inspection-rig-daily-check-2026-10-27.pdf');
    const text = inspectPdf(pdf).pages.flat().join('\n');
    expect(text).toContain('Rig daily check');
    expect(text).toContain('Ivan Inspector');
    expect(text).toContain('Client: Not signed');
    expect(text).toContain('Shared with you through');
    expect(text).not.toMatch(/Generated .* by/);
  });

  it('isn’t there for another project’s report or an unknown one, and needs a session', async () => {
    const { link, session } = await signedIn();
    for (const id of ['i-other', 'nope', '']) await expect(svc.inspectionPdf(link, session, id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.inspectionPdf(link, () => null, 'i-shown')).rejects.toBeInstanceOf(ClientSignInRequiredError);
  });

  it('shows none when the inspections module isn’t wired', async () => {
    const plain = createClientAccessService({
      store: createMemoryClientShareStore(),
      source: createMemoryClientViewSource(),
      mailer: { isConfigured: () => true, sendClientInvitation: async () => 'sent', sendClientCode: async () => {} },
      userName: async () => null,
      appUrl: 'https://x.test',
      assetUrl: 'https://x.test',
      timeZone: 'Asia/Muscat',
    });
    await expect(plain.inspectionPdf('x'.repeat(43), () => null, 'i')).rejects.toMatchObject({ status: 404 });
  });
});
