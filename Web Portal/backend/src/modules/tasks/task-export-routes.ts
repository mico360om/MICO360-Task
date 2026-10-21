import type { FastifyInstance } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { buildXlsx, XLSX_CONTENT_TYPE } from '../../lib/xlsx-writer';
import { BRAND, fileSlug } from '../../lib/export-format';
import { readProjectPicture } from '../../lib/pdf-image';
import { taskPdf, taskSheets, withPictures, type TaskExportData, type TaskExportSource } from './task-export';

export interface TaskExportRouteDeps {
  guard: AuthGuard;
  source: TaskExportSource;
  /** Who may see a task (as for GET /tasks/:id); undefined leaves the routes open (unit tests). */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** The signed-in user's name, shown as the document's author. */
  userName?: (userId: string) => Promise<string | null>;
  timeZone: string;
  /** Reads an attached file's stored bytes (by its storage key), so the PDF shows the task's pictures; without it they are listed. */
  readAttachment?: (storageKey: string) => Promise<Buffer | null>;
  /** Makes a small picture a PDF can print (a JPEG thumbnail) from a stored one; without it a JPEG or PNG is printed as stored. */
  pictureThumbnail?: (raw: Buffer) => Promise<Buffer | null>;
  /** Reads the project's uploaded picture ('/uploads/…') for the PDF's badge, as the minutes PDF does. */
  readProjectImage?: (imageUrl: string) => Promise<Buffer | null>;
  /** Converts a project picture the PDF can't take as stored (WebP, GIF, some PNGs). */
  printableProjectImage?: (raw: Buffer) => Promise<Buffer | null>;
}

/** The task with what only its PDF shows: the project's picture and the task's own pictures. */
async function forPdf(data: TaskExportData, deps: TaskExportRouteDeps): Promise<TaskExportData> {
  const [projectImage, withFiles] = await Promise.all([
    readProjectPicture(data.projectImageUrl, deps.readProjectImage, deps.printableProjectImage),
    deps.readAttachment ? withPictures(data, { read: deps.readAttachment, thumbnail: deps.pictureThumbnail }) : data,
  ]);
  return projectImage ? { ...withFiles, projectImage } : withFiles;
}

/** GET /tasks/:id/export.xlsx and /tasks/:id/export.pdf — one task as a document, for anyone who can open it. */
export async function registerTaskExportRoutes(app: FastifyInstance, deps: TaskExportRouteDeps): Promise<void> {
  for (const format of ['xlsx', 'pdf'] as const) {
    app.get(`/tasks/:id/export.${format}`, { preHandler: deps.guard.authenticate }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;
      const notFound = () => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
      if (deps.canViewTask && !(await deps.canViewTask(user.id, user.roles ?? [], id))) return notFound();
      const data = await deps.source.load(id);
      if (!data) return notFound();
      const ctx = { generatedAt: new Date(), timeZone: deps.timeZone, generatedBy: (await deps.userName?.(user.id)) ?? null };
      const file = `${data.key}-${fileSlug(data.title)}.${format}`;
      const body =
        format === 'xlsx'
          ? buildXlsx(taskSheets(data, ctx), { title: `${data.key} · ${data.title}`, brand: BRAND }, ctx.generatedAt)
          : taskPdf(await forPdf(data, deps), ctx);
      return reply
        .header('Content-Type', format === 'xlsx' ? XLSX_CONTENT_TYPE : 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${file}"`)
        .header('Cache-Control', 'no-store')
        .send(body);
    });
  }
}
