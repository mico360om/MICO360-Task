import { createReadStream } from 'node:fs';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import { NotFoundError } from '../../lib/http-errors';
import type { BackupService } from './backup-service';
import type { createBackupDrive } from './drive-connection';
import type { OneTimeTokens } from './one-time-tokens';

export interface BackupRouteDeps {
  guard: AuthGuard;
  service: Pick<BackupService, 'overview' | 'start' | 'fileFor'>;
  drive: Pick<ReturnType<typeof createBackupDrive>, 'connectUrl' | 'complete' | 'disconnect'>;
  /** Signs the short-lived download links (purpose: backup downloads). */
  downloads: OneTimeTokens;
  /** Is this person (still) an active administrator? Checked when a download link is used. */
  isActiveAdmin: (userId: string) => Promise<boolean>;
  audit?: AuditService;
  /** Where the web app is: Google sends the administrator back to its System Settings. */
  appUrl: string;
}

/** Download links work once, for two minutes. */
const LINK_TTL_MS = 2 * 60 * 1000;
const idParam = z.object({ id: z.string().min(1).max(64) });
const tokenQuery = z.object({ token: z.string().max(2000).default('') });
const callbackQuery = z.object({ code: z.string().max(2000).optional(), state: z.string().max(2000).optional(), error: z.string().max(200).optional() });

/** A plain-text answer for a link opened in the browser (not by the app's own code). */
function plain(reply: FastifyReply, status: number, text: string) {
  return reply.status(status).header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'no-store').send(text);
}

/**
 * System Settings → Backups (administrators only): the overview, "Back up now", downloading a copy
 * (a 2-minute single-use link, so a big file streams straight to disk), and Google Drive.
 */
export async function registerBackupRoutes(app: FastifyInstance, deps: BackupRouteDeps): Promise<void> {
  const admin = { preHandler: deps.guard.requireRoles('ADMIN') };
  const record = (entry: { userId: string | null; ip: string | null; action: string; entityId?: string | null; oldValue?: unknown; newValue?: unknown }) =>
    deps.audit?.record({ module: 'backups', entityId: null, oldValue: null, newValue: null, ...entry });

  app.get('/backups', admin, async () => ({ data: await deps.service.overview() }));

  app.post('/backups', admin, async (req, reply) => {
    const run = await deps.service.start(req.user!.id);
    await record({ userId: req.user!.id, ip: req.ip ?? null, action: 'backup.create', entityId: run.id });
    return reply.status(202).send({ data: { id: run.id, status: run.status, trigger: run.trigger, startedAt: run.startedAt } });
  });

  app.post('/backups/:id/download-link', admin, async (req) => {
    const { id } = idParam.parse(req.params);
    const file = await deps.service.fileFor(id);
    if (!file) throw new NotFoundError('That copy is no longer kept.');
    const token = deps.downloads.issue({ id, userId: req.user!.id }, LINK_TTL_MS);
    await record({ userId: req.user!.id, ip: req.ip ?? null, action: 'backup.download-link', entityId: id, newValue: { fileName: file.fileName } });
    return { data: { url: `/api/v1/backups/download?${new URLSearchParams({ token })}` } };
  });

  // Opened by the browser itself (a plain navigation): the signed link stands in for the sign-in.
  app.get('/backups/download', async (req, reply) => {
    const { token } = tokenQuery.parse(req.query);
    const link = deps.downloads.verify(token);
    if (!link?.id || !link.userId) return plain(reply, 410, 'This download link has expired or was already used. Go back to System Settings and press Download again.');
    if (!(await deps.isActiveAdmin(link.userId))) return plain(reply, 403, 'Only administrators can download backups.');
    const file = await deps.service.fileFor(link.id);
    if (!file) return plain(reply, 404, 'That copy is no longer kept.');
    await record({ userId: link.userId, ip: req.ip ?? null, action: 'backup.download', entityId: link.id, newValue: { fileName: file.fileName, sizeBytes: file.sizeBytes } });
    return reply
      .header('content-type', file.fileName.endsWith('.enc') ? 'application/octet-stream' : 'application/gzip')
      .header('content-length', String(file.sizeBytes))
      .header('content-disposition', `attachment; filename="${file.fileName}"`)
      .header('cache-control', 'no-store')
      .send(createReadStream(file.path));
  });

  app.post('/backups/google/connect', admin, async (req) => ({ data: { url: deps.drive.connectUrl(req.user!.id) } }));

  // Google sends the administrator here after the consent screen.
  app.get('/backups/google/callback', async (req, reply) => {
    const answer = callbackQuery.safeParse(req.query);
    const done = answer.success ? await deps.drive.complete(answer.data) : { result: 'failed' as const, userId: null, email: null };
    if (done.result === 'connected') await record({ userId: done.userId, ip: req.ip ?? null, action: 'backup.drive-connect', newValue: { email: done.email } });
    return reply.redirect(`${deps.appUrl.replace(/\/+$/, '')}/admin/settings?drive=${done.result}#backups`, 302);
  });

  app.delete('/backups/google', admin, async (req) => {
    const gone = await deps.drive.disconnect();
    await record({ userId: req.user!.id, ip: req.ip ?? null, action: 'backup.drive-disconnect', oldValue: gone ? { email: gone.email } : null });
    return { data: { disconnected: true } };
  });
}
