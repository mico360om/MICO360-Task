import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sharp from 'sharp';
import { registerTaskExportRoutes, type TaskExportRouteDeps } from './task-export-routes';
import type { TaskExportAttachment, TaskExportData } from './task-export';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { inspectPdf } from '../../lib/pdf-inspect';
import { blankPng } from '../../lib/test-images';
import { createImageShrinker } from '../../lib/image-shrink';

const attachment = (filename: string, mimeType: string): TaskExportAttachment => ({
  filename, mimeType, sizeBytes: 2048, storageKey: `key-${filename}`, uploadedBy: 'Omar Ahmed', uploadedAt: new Date('2026-09-01T00:00:00Z'),
});

const data: TaskExportData = {
  key: 'MICO-7', title: 'Inspect the rig', description: null, projectName: 'Rig Inspection Portal', projectCode: 'RIG', projectNumber: null, projectColor: null, projectIcon: null,
  status: 'To do', category: 'TODO', priority: 'NORMAL',
  startDate: null, dueDate: null, completedAt: null, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'), progress: 0, estimatedHours: null, actualHours: null,
  createdBy: 'Aisha Khan', assignees: [], watchers: [], tags: [], repeat: null, overdue: false, isMilestone: false, meeting: null,
  checklist: [], blockedBy: [], blocks: [], attachments: [], comments: [], mentionable: [], activity: [],
};

const withFiles: TaskExportData = {
  ...data,
  attachments: [attachment('deck.jpg', 'image/jpeg'), attachment('notes.xlsx', 'application/vnd.ms-excel'), attachment('site.png', 'image/png')],
};

async function makeApp(opts: { canView?: boolean; userId?: string | null; task?: TaskExportData; extra?: Partial<TaskExportRouteDeps> } = {}) {
  const app = Fastify();
  const guard = {
    authenticate: async (req: { user?: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      if (opts.userId === null) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } });
      req.user = { id: opts.userId ?? 'u1', roles: ['EMPLOYEE'] };
    },
  };
  await registerTaskExportRoutes(app, {
    guard: guard as never,
    source: { async load(id) { return id === 't1' ? (opts.task ?? data) : null; } },
    canViewTask: async () => opts.canView ?? true,
    userName: async () => 'Omar Ahmed',
    timeZone: 'Asia/Muscat',
    ...opts.extra,
  });
  return app;
}

/** Pictures 40 pixels wide embedded in a PDF. */
const pictures = (pdf: Buffer) => [...inspectPdf(pdf).objects.values()].filter((d) => /\/Subtype \/Image/.test(d) && /\/Width 40\b/.test(d)).length;

describe('Task export routes', () => {
  it('downloads a task as an .xlsx workbook named after its key', async () => {
    const res = await (await makeApp()).inject({ method: 'GET', url: '/tasks/t1/export.xlsx' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="MICO-7-inspect-the-rig\.xlsx"/);
    expect(res.headers['cache-control']).toBe('no-store');
    const { sheets, text } = inspectXlsx(res.rawPayload);
    expect(sheets[0]).toBe('Task');
    expect(text[0]!.join(' ')).toContain('by Omar Ahmed');
  });

  it('downloads a task as a PDF', async () => {
    const res = await (await makeApp()).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/MICO-7-inspect-the-rig\.pdf/);
    expect(inspectPdf(res.rawPayload).pages.flat()).toContain('Inspect the rig');
  });

  it('puts the task’s pictures in the PDF, read from storage and made small; the workbook reads nothing', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const readAttachment = vi.fn(async () => Buffer.from('stored picture'));
    const pictureThumbnail = vi.fn(async () => jpeg);
    const app = await makeApp({ task: withFiles, extra: { readAttachment, pictureThumbnail } });
    const res = await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(readAttachment.mock.calls.map((c: unknown[]) => c[0])).toEqual(['key-deck.jpg', 'key-site.png']);
    expect(pictureThumbnail).toHaveBeenCalledTimes(2);
    expect(pictures(res.rawPayload)).toBe(2);
    expect(inspectPdf(res.rawPayload).pages.flat()).toEqual(expect.arrayContaining(['deck.jpg', 'site.png', 'notes.xlsx']));

    readAttachment.mockClear();
    expect((await app.inject({ method: 'GET', url: '/tasks/t1/export.xlsx' })).statusCode).toBe(200);
    expect(readAttachment).not.toHaveBeenCalled();
  });

  it('prints the project’s uploaded picture as its badge, read from where uploads are stored; the workbook reads nothing', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa3322' } }).png().toBuffer();
    const readProjectImage = vi.fn(async () => png);
    const app = await makeApp({ task: { ...data, projectImageUrl: '/uploads/projects/rig.png' }, extra: { readProjectImage } });
    const res = await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(readProjectImage).toHaveBeenCalledWith('/uploads/projects/rig.png');
    expect(pictures(res.rawPayload)).toBe(1);

    readProjectImage.mockClear();
    expect((await app.inject({ method: 'GET', url: '/tasks/t1/export.xlsx' })).statusCode).toBe(200);
    expect(readProjectImage).not.toHaveBeenCalled();
  });

  it('converts a project picture the PDF can’t print as stored (WebP), so the badge still shows it', async () => {
    const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa3322' } }).webp().toBuffer();
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa3322' } }).jpeg().toBuffer();
    const printableProjectImage = vi.fn(async () => jpeg);
    const app = await makeApp({ task: { ...data, projectImageUrl: '/uploads/projects/rig.webp' }, extra: { readProjectImage: async () => webp, printableProjectImage } });
    const res = await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(printableProjectImage).toHaveBeenCalledTimes(1);
    expect(pictures(res.rawPayload)).toBe(1);
  });

  it('prints an interlaced project picture once converted, and the initials without a converter: a whole PDF either way', async () => {
    const interlaced = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa3322' } }).png({ progressive: true }).toBuffer();
    const task = { ...data, projectImageUrl: '/uploads/projects/rig.png' };
    const converted = await (await makeApp({ task, extra: { readProjectImage: async () => interlaced, printableProjectImage: createImageShrinker().toPrintable } })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(converted.statusCode).toBe(200);
    expect(pictures(converted.rawPayload)).toBe(1); // inspectPdf throws on a broken file
    const asStored = await (await makeApp({ task, extra: { readProjectImage: async () => interlaced } })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(asStored.statusCode).toBe(200);
    expect(pictures(asStored.rawPayload)).toBe(0);
    expect(inspectPdf(asStored.rawPayload).pages.flat()).toContain('RI');
  });

  it('prints the initials, not an error, when the PDF can’t read the project picture (a damaged JPEG)', async () => {
    const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xd9])]);
    const res = await (await makeApp({ task: { ...data, projectImageUrl: '/uploads/projects/rig.jpg' }, extra: { readProjectImage: async () => damaged } })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(inspectPdf(res.rawPayload).pages.flat()).toContain('RI');
  });

  it('falls back to the project’s initials when its picture can’t be read', async () => {
    const readProjectImage = async () => {
      throw new Error('ENOENT');
    };
    const res = await (await makeApp({ task: { ...data, projectImageUrl: '/uploads/projects/gone.png' }, extra: { readProjectImage } })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(pictures(res.rawPayload)).toBe(0);
    expect(inspectPdf(res.rawPayload).pages.flat()).toContain('RI');
  });

  it('still makes the PDF without file storage: the pictures are listed', async () => {
    const res = await (await makeApp({ task: withFiles })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(pictures(res.rawPayload)).toBe(0);
    expect(inspectPdf(res.rawPayload).pages.flat()).toEqual(expect.arrayContaining(['3 files', 'deck.jpg', 'site.png', 'notes.xlsx']));
  });

  it('still makes the PDF when a stored picture can’t be read: it is listed', async () => {
    const readAttachment = async () => {
      throw new Error('ENOENT');
    };
    const res = await (await makeApp({ task: withFiles, extra: { readAttachment } })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(res.statusCode).toBe(200);
    expect(inspectPdf(res.rawPayload).pages.flat()).toContain('deck.jpg (picture could not be shown)');
  });

  it('lists a crafted picture the thumbnail maker turns down instead of unpacking it (a "zip bomb" that would freeze the server)', async () => {
    const bomb = await blankPng(64, 64, { unpacked: 256 * 1024 * 1024, brokenChecksum: true });
    const app = await makeApp({ task: { ...data, attachments: [attachment('site.png', 'image/png')] }, extra: { readAttachment: async () => bomb, pictureThumbnail: async () => null } });
    const started = performance.now();
    const res = await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    const ms = performance.now() - started;
    expect(res.statusCode).toBe(200);
    expect(inspectPdf(res.rawPayload).pages.flat()).toContain('site.png (picture could not be shown)');
    expect(ms).toBeLessThan(2000);
  }, 30_000);

  describe('the meeting the task came from', () => {
    const fromMeeting: TaskExportData = { ...data, meeting: { id: 'm1', title: 'Weekly review', startAt: new Date('2026-09-27T06:00:00Z') } };

    it('shows its title and day to someone who can see the meeting', async () => {
      const canViewMeeting = vi.fn(async () => true);
      const res = await (await makeApp({ task: fromMeeting, extra: { canViewMeeting } })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
      expect(res.statusCode).toBe(200);
      expect(canViewMeeting).toHaveBeenCalledWith('u1', ['EMPLOYEE'], 'm1');
      const text = inspectPdf(res.rawPayload).pages.flat();
      expect(text).toContain('From meeting');
      expect(text.join(' ')).toContain('Weekly review · 27 Sep 2026');
    });

    it('only says the task came from a meeting to someone not part of it, as the website does', async () => {
      const res = await (await makeApp({ task: fromMeeting, extra: { canViewMeeting: async () => false } })).inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
      expect(res.statusCode).toBe(200);
      const text = inspectPdf(res.rawPayload).pages.flat().join(' ');
      expect(text).toContain('From meeting');
      expect(text).toContain('A meeting you’re not part of');
      expect(text).not.toContain('Weekly review');
      expect(text).not.toContain('27 Sep 2026');
    });
  });

  it('lists only the blocking and waiting tasks the reader can open, in the PDF and the workbook, as the website does', async () => {
    const linked: TaskExportData = {
      ...data,
      blockedBy: [
        { id: 't2', key: 'HR-2', title: 'Hidden salary review', status: 'To do' },
        { id: 't3', key: 'RIG-3', title: 'Order the parts', status: 'Done' },
      ],
      blocks: [{ id: 't4', key: 'HR-4', title: 'Hidden follow-up', status: 'To do' }],
    };
    const open = new Set(['t1', 't3']);
    const canViewTask = vi.fn(async (_u: string, _r: string[], taskId: string) => open.has(taskId));
    const app = await makeApp({ task: linked, extra: { canViewTask } });

    const pdf = await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' });
    expect(pdf.statusCode).toBe(200);
    const text = inspectPdf(pdf.rawPayload).pages.flat().join(' ');
    expect(text).toContain('Order the parts');
    for (const hidden of ['HR-2', 'Hidden salary review', 'HR-4', 'Hidden follow-up']) expect(text, hidden).not.toContain(hidden);
    expect(text).toContain('No other task waits for this one.');

    const xlsx = await app.inject({ method: 'GET', url: '/tasks/t1/export.xlsx' });
    const { sheets, text: cells } = inspectXlsx(xlsx.rawPayload);
    const deps = cells[sheets.indexOf('Dependencies')]!.join(' ');
    expect(deps).toContain('Order the parts');
    for (const hidden of ['HR-2', 'Hidden salary review', 'HR-4', 'Hidden follow-up']) expect(deps, hidden).not.toContain(hidden);
    expect(canViewTask.mock.calls.map((c) => c[2]).sort()).toEqual(['t1', 't1', 't2', 't2', 't3', 't3', 't4', 't4']);
  });

  it('names a blocker in the activity only to a reader who can open it, in the PDF and the workbook', async () => {
    const at = new Date('2026-09-02T06:00:00Z');
    const withBlockers: TaskExportData = {
      ...data,
      activity: [
        { at, who: 'Omar Ahmed', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 't2', key: 'HR-2', title: 'Hidden salary review' } },
        { at, who: 'Omar Ahmed', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 't3', key: 'RIG-3', title: 'Order the parts' } },
      ],
    };
    const open = new Set(['t1', 't3']);
    const app = await makeApp({ task: withBlockers, extra: { canViewTask: async (_u: string, _r: string[], taskId: string) => open.has(taskId) } });

    const text = inspectPdf((await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' })).rawPayload).pages.flat().join(' ');
    expect(text).toContain('Added a blocker');
    expect(text).toContain('Order the parts');
    for (const hidden of ['HR-2', 'Hidden salary review']) expect(text, hidden).not.toContain(hidden);

    const { sheets, text: cells } = inspectXlsx((await app.inject({ method: 'GET', url: '/tasks/t1/export.xlsx' })).rawPayload);
    const activity = cells[sheets.indexOf('Activity')]!.join(' ');
    expect(activity).toContain('Added a blocker');
    for (const hidden of ['HR-2', 'Hidden salary review']) expect(activity, hidden).not.toContain(hidden);
  });

  it('hides tasks the user cannot see (404), like opening the task', async () => {
    const app = await makeApp({ canView: false });
    expect((await app.inject({ method: 'GET', url: '/tasks/t1/export.pdf' })).statusCode).toBe(404);
    expect((await (await makeApp()).inject({ method: 'GET', url: '/tasks/nope/export.xlsx' })).statusCode).toBe(404);
  });

  it('requires sign-in (401)', async () => {
    expect((await (await makeApp({ userId: null })).inject({ method: 'GET', url: '/tasks/t1/export.xlsx' })).statusCode).toBe(401);
  });
});
