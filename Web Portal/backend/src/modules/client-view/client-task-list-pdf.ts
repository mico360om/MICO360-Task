import { PdfDocument, hexToRgb, type TableColumn } from '../../lib/pdf-document';
import { isolate } from '../../lib/pdf-text';
import { MINUTES_TYPE, fmtDay, projectFacts, type MinutesBrand } from '../meetings/minutes';
import { PROJECT_ICON_PATHS, projectInitials, type ProjectIcon } from '../projects/project-icons';

/**
 * 1.23 The Client portal's task list PDF: the project's progress, its milestones and its tasks marked
 * "Show to client" — each one's number, title, status, due day and whether the client accepted it.
 * Its data has no field for a person, a column name, a description or a comment, so it can't print one.
 */
export interface ClientTaskRow {
  key: string;
  title: string;
  status: string;
  /** 'YYYY-MM-DD' (company time) or null. */
  dueDate: string | null;
  late: boolean;
  acceptedOn: string | null;
}

export interface ClientTaskListPdfData {
  brand: Pick<MinutesBrand, 'productName' | 'companyName' | 'websiteUrl' | 'supportEmail' | 'companyAddress' | 'colors'>;
  logo?: Buffer | null;
  project: { name: string; code: string | null; number: string | null; clientName: string | null; color: string | null; icon: string | null; image: Buffer | null };
  percentDone: number;
  milestones: ClientTaskRow[];
  tasks: ClientTaskRow[];
  timeZone: string;
  generatedAt: string;
}

const day = (key: string | null, tz: string) => (key ? fmtDay(`${key}T12:00:00Z`, tz) : '—');

export function buildClientTaskListPdf(data: ClientTaskListPdfData): Buffer {
  const { brand, project, timeZone: tz } = data;
  const footer = [
    [brand.companyName, brand.websiteUrl, brand.supportEmail].filter((b): b is string => Boolean(b)).map(isolate).join('  ·  '),
    brand.companyAddress,
    `Shared with you through ${isolate(brand.productName)}`,
  ]
    .filter(Boolean)
    .join('\n');
  const doc = new PdfDocument({
    title: `Task list: ${project.name}`,
    palette: { brand: brand.colors?.brand, ink: brand.colors?.ink, muted: brand.colors?.muted, line: brand.colors?.line },
    footerLeft: footer,
    density: 'compact',
    ...(data.logo ? { logo: data.logo } : {}),
  });
  doc.identityHeader({
    image: project.image ?? null,
    icon: project.icon && project.icon in PROJECT_ICON_PATHS ? PROJECT_ICON_PATHS[project.icon as ProjectIcon] : null,
    initials: projectInitials(project.name),
    color: project.color ? hexToRgb(project.color, hexToRgb(brand.colors?.brand ?? '#8B1E1E')) : undefined,
    eyebrow: 'Project progress',
    title: project.name,
    badge: { text: `${Math.max(0, Math.min(100, Math.round(data.percentDone)))}% done`, tone: 'success' },
  });
  doc.keyValueColumns(projectFacts(project), [['Printed', fmtDay(data.generatedAt, tz)], ['Time zone', tz]], { size: MINUTES_TYPE.facts });

  const columns: TableColumn[] = [{ header: 'No.', nowrap: true }, { header: 'Task' }, { header: 'Status', nowrap: true }, { header: 'Due', nowrap: true }, { header: 'Accepted', nowrap: true }];
  const rowsOf = (list: ClientTaskRow[]) => list.map((t) => [t.key, t.title, t.late ? `${t.status} (late)` : t.status, day(t.dueDate, tz), t.acceptedOn ? day(t.acceptedOn, tz) : '—']);
  if (data.milestones.length) {
    doc.subheading('Milestones');
    doc.table(columns, rowsOf(data.milestones), { wide: 1 });
  }
  doc.subheading('Tasks');
  if (data.tasks.length) doc.table(columns, rowsOf(data.tasks), { wide: 1 });
  else doc.text('No tasks are shared with you yet.', { size: MINUTES_TYPE.facts });
  return doc.build();
}
