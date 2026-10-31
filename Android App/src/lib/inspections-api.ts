import type { ApiClient } from './api-client';
import { idempotencyHeaders } from './idempotency';
import type {
  AnswerOutcome,
  AnswerWrite,
  ClientInspection,
  DueCheck,
  FinishInput,
  FollowUpResult,
  InspectionDetail,
  InspectionForm,
  InspectionListItem,
  InspectionSchedule,
} from './inspection-types';
import type { ScheduleCreateBody } from './inspection-schedule-form';
import type { ApiTask } from './types';

/**
 * The website's inspection calls (`api/inspections.ts`), the same paths and verbs — only the ones a
 * phone makes (forms are edited on the website). `start` sends an idempotency key, so a Start whose
 * answer was lost never makes two inspections. The report is downloaded by the exporter from
 * `reportPdfPath`. It is the outbox's `OutboxApi` as it is (answer, finish, makeFollowUps).
 */
const seg = encodeURIComponent;

export function inspectionsApi(client: Pick<ApiClient, 'get' | 'post' | 'put' | 'del'>) {
  return {
    // Forms (to start one; editing them stays on the website)
    listForms: () => client.get<{ data: { forms: InspectionForm[]; canCreate: boolean } }>('/inspection-forms').then((r) => r.data),

    // Inspections
    listForProject: (projectId: string) =>
      client.get<{ data: { inspections: InspectionListItem[]; canStart: boolean } }>(`/projects/${seg(projectId)}/inspections`).then((r) => r.data),
    start: (projectId: string, input: { formId: string; taskId?: string | null; place?: string | null }, idempotencyKey?: string) =>
      client.post<{ data: InspectionDetail }>(`/projects/${seg(projectId)}/inspections`, input, idempotencyHeaders(idempotencyKey)).then((r) => r.data),
    get: (id: string) => client.get<{ data: InspectionDetail }>(`/inspections/${seg(id)}`).then((r) => r.data),
    answer: (id: string, answers: AnswerWrite[]) =>
      client.put<{ data: { results: AnswerOutcome[]; inspection: InspectionListItem } }>(`/inspections/${seg(id)}/answers`, { answers }).then((r) => r.data),
    finish: (id: string, input: FinishInput) => client.post<{ data: InspectionDetail }>(`/inspections/${seg(id)}/finish`, input).then((r) => r.data),
    reopen: (id: string) => client.post<{ data: InspectionDetail }>(`/inspections/${seg(id)}/reopen`, {}).then((r) => r.data),
    takeOver: (id: string) => client.post<{ data: InspectionDetail }>(`/inspections/${seg(id)}/take-over`, {}).then((r) => r.data),
    remove: (id: string) => client.del<void>(`/inspections/${seg(id)}`),
    makeFollowUps: (id: string, input: { itemIds: string[]; assigneeId?: string | null }) =>
      client.post<{ data: FollowUpResult[] }>(`/inspections/${seg(id)}/follow-ups`, input).then((r) => r.data),

    // Scheduled inspections
    schedules: (projectId: string) =>
      client.get<{ data: { schedules: InspectionSchedule[]; workingDays: number[] } }>(`/projects/${seg(projectId)}/inspection-schedules`).then((r) => r.data),
    dueChecks: (projectId: string) => client.get<{ data: { checks: DueCheck[]; total: number } }>(`/projects/${seg(projectId)}/inspection-checks?state=open`).then((r) => r.data),
    /** A new schedule: the website makes it through its tasks API (a task that carries a form and a repeat). */
    createCheckSeries: (body: ScheduleCreateBody, idempotencyKey: string) => client.post<{ data: ApiTask }>('/tasks', body, idempotencyHeaders(idempotencyKey)).then((r) => r.data),
    /** A schedule changed or stopped, on the series' newest copy (`expectedVersion`, `requireNewest`). */
    updateCheckSeries: (taskId: string, patch: Record<string, unknown>) => client.put<{ data: ApiTask }>(`/tasks/${seg(taskId)}`, patch).then((r) => r.data),
    forTask: (taskId: string) =>
      client.get<{ data: { attached: InspectionListItem[]; followUpOf: { inspection: InspectionListItem; item: string } | null } }>(`/tasks/${seg(taskId)}/inspections`).then((r) => r.data),
    /** The report PDF's path, for the exporter (it downloads with the session and shares the file). */
    reportPdfPath: (id: string) => `/inspections/${seg(id)}/report.pdf`,

    // Show to client
    clientPreview: (id: string) => client.get<{ data: { inspection: ClientInspection; names: string[] } }>(`/inspections/${seg(id)}/client-visibility/preview`).then((r) => r.data),
    setClientVisible: (id: string, visible: boolean) => client.put<{ data: { clientVisible: boolean } }>(`/inspections/${seg(id)}/client-visibility`, { visible }).then((r) => r.data),
  };
}

export type InspectionsApi = ReturnType<typeof inspectionsApi>;
