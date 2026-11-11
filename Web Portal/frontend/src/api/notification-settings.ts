import type { ApiClient } from '../lib/api-client';

/**
 * Notification & Scheduling centre (System Settings → Notification & Scheduling): each company's
 * working time, holidays, reminder schedules and notification rules, and "Preview for a person".
 * The server owns the rules (modules/notify-policy); these are its shapes.
 */

export const POLICY_KINDS = [
  'assigned',
  'dueSoon',
  'overdue',
  'escalation',
  'escalationAdmin',
  'approvals',
  'approvalWaiting',
  'inactivity',
  'mentions',
  'comments',
  'status',
  'projectAdded',
  'meetings',
  // Training Center: every training notice in one row (bell and push on, email off by default).
  'training',
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** The reminders the planner makes; an admin can turn each off for the company. */
export const REMINDER_KINDS = ['dueSoon', 'overdue', 'escalation', 'escalationAdmin', 'approvalWaiting', 'inactivity'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export interface Channels {
  bell: boolean;
  push: boolean;
  email: boolean;
}

export interface CompanyQuietHours {
  mode: 'workingHours' | 'custom';
  start: string;
  end: string;
  meetings: boolean;
  mentions: boolean;
}

export interface NotificationPolicy {
  remindersOn: Record<ReminderKind, boolean>;
  required: PolicyKind[];
  escalation: { step1Days: number; step2Days: number; admins: boolean; userIds: string[] };
  approvals: { step1Days: number; step2Days: number };
  inactivity: { assigneeDays: number; managerDays: number };
  quietHours: CompanyQuietHours;
  channels: Record<PolicyKind, Channels>;
}
export type PolicySection = keyof NotificationPolicy;

export interface ScheduleSteps {
  before: number[];
  onDue: boolean;
  after: number[];
  repeatEvery: number | null;
}

export interface ApiSchedule {
  id: string;
  name: string;
  steps: ScheduleSteps;
  builtIn: string | null;
  isDefault: boolean;
}

export interface ApiHoliday {
  id: string;
  day: string;
  name: string;
  recurring: boolean;
  source: 'STARTER' | 'ADMIN';
  expected: boolean;
}

export interface WorkingHours {
  days: number[];
  start: string;
  end: string;
}

export interface WorkingTimeView {
  weekStart: 0 | 1 | 6;
  workingHours: WorkingHours;
  /** The company has its own (else it follows the site's). */
  own: boolean;
}

export interface CompanyNotificationSettings {
  companyId: string;
  timeZone: string;
  policy: NotificationPolicy;
  defaults: NotificationPolicy;
  holidays: ApiHoliday[];
  schedules: ApiSchedule[];
  banners: { name: string; year: number; day: string; text: string }[];
  workingTime: WorkingTimeView;
  people: { id: string; name: string; email: string | null; admin: boolean }[];
  meetingReminders: unknown;
}

export type ChannelAction = 'now' | 'hold' | 'off';

export interface PreviewItem {
  kind: ReminderKind;
  type: string;
  title: string;
  body: string;
  taskId: string;
  bell: boolean;
  push: ChannelAction;
  email: ChannelAction;
  releaseAt: string | null;
}

export interface PersonPreview {
  person: { id: string; name: string; active: boolean };
  companyId: string;
  quietHours: { mode: 'off' } | { zone: string; start: string; end: string; daysOff: boolean };
  paused: string | null;
  days: { day: string; working: boolean; holiday: string | null; items: PreviewItem[] }[];
}

/** The person's own rules (Settings → Notifications). */
export interface PersonPolicy {
  companyId: string | null;
  companyName: string | null;
  timeZone: string;
  personZone: string;
  weekStart: 0 | 1 | 6;
  workingDays: number[];
  hours: { start: string; end: string };
  quietHours: CompanyQuietHours;
  kinds: {
    key: PolicyKind;
    types: string[];
    required: boolean;
    defaults: Channels;
    emailChannel: boolean;
    on: boolean;
    current: Channels & { required: boolean };
  }[];
}

export interface ProjectReminders {
  scheduleId: string | null;
  escalationDays: { step1Days: number; step2Days: number } | null;
  schedules: { id: string; name: string; isDefault: boolean; steps: ScheduleSteps }[];
  companyEscalation: { step1Days: number; step2Days: number };
  canEdit: boolean;
}

export interface TaskReminderSchedule {
  scheduleId: string | null;
  projectScheduleId: string | null;
  inUseId: string | null;
  schedules: { id: string; name: string; isDefault: boolean; steps: ScheduleSteps }[];
  canEdit: boolean;
}

export const NOTIFICATION_SETTINGS_KEY = ['notification-settings'] as const;
export const PERSON_POLICY_KEY = ['notification-policy'] as const;

const base = (companyId: string) => `/notification-settings/${encodeURIComponent(companyId)}`;

export function notificationSettingsApi(client: ApiClient) {
  return {
    companies: () => client.get<{ data: { companies: { id: string; name: string }[]; timeZone: string } }>('/notification-settings').then((r) => r.data),
    get: (companyId: string) => client.get<{ data: CompanyNotificationSettings }>(base(companyId)).then((r) => r.data),
    saveWorkingTime: (companyId: string, value: { weekStart: 0 | 1 | 6; workingHours: WorkingHours }) =>
      client.put<{ data: WorkingTimeView }>(`${base(companyId)}/working-time`, value).then((r) => r.data),
    followSite: (companyId: string) => client.del<{ data: WorkingTimeView }>(`${base(companyId)}/working-time`).then((r) => r.data),
    savePolicy: (companyId: string, patch: Partial<NotificationPolicy>) => client.put<{ data: NotificationPolicy }>(`${base(companyId)}/policy`, patch).then((r) => r.data),
    addHoliday: (companyId: string, h: { day: string; name: string; recurring: boolean }) => client.post<{ data: ApiHoliday }>(`${base(companyId)}/holidays`, h).then((r) => r.data),
    updateHoliday: (companyId: string, id: string, patch: Partial<Pick<ApiHoliday, 'day' | 'name' | 'recurring' | 'expected'>>) =>
      client.put<{ data: ApiHoliday }>(`${base(companyId)}/holidays/${encodeURIComponent(id)}`, patch).then((r) => r.data),
    removeHoliday: (companyId: string, id: string) => client.del<{ data: { ok: boolean } }>(`${base(companyId)}/holidays/${encodeURIComponent(id)}`),
    addStarterYear: (companyId: string, year: number) => client.post<{ data: { added: number } }>(`${base(companyId)}/holidays/starter`, { year }).then((r) => r.data),
    addSchedule: (companyId: string, s: { name: string; steps: ScheduleSteps }) => client.post<{ data: ApiSchedule }>(`${base(companyId)}/schedules`, s).then((r) => r.data),
    updateSchedule: (companyId: string, id: string, patch: { name?: string; steps?: ScheduleSteps }) =>
      client.put<{ data: ApiSchedule }>(`${base(companyId)}/schedules/${encodeURIComponent(id)}`, patch).then((r) => r.data),
    removeSchedule: (companyId: string, id: string) => client.del<{ data: { ok: boolean } }>(`${base(companyId)}/schedules/${encodeURIComponent(id)}`),
    setDefaultSchedule: (companyId: string, id: string) => client.post<{ data: ApiSchedule[] }>(`${base(companyId)}/schedules/${encodeURIComponent(id)}/default`).then((r) => r.data),
    preview: (companyId: string, userId: string) => client.get<{ data: PersonPreview }>(`${base(companyId)}/preview?userId=${encodeURIComponent(userId)}`).then((r) => r.data),
    /** The signed-in person's own company rules. */
    personPolicy: () => client.get<{ data: PersonPolicy }>('/notifications/policy').then((r) => r.data),
    projectReminders: (projectId: string) => client.get<{ data: ProjectReminders }>(`/projects/${encodeURIComponent(projectId)}/reminders`).then((r) => r.data),
    saveProjectReminders: (projectId: string, body: { scheduleId?: string | null; escalationDays?: { step1Days: number; step2Days: number } | null }) =>
      client.put<{ data: ProjectReminders }>(`/projects/${encodeURIComponent(projectId)}/reminders`, body).then((r) => r.data),
    taskSchedule: (taskId: string) => client.get<{ data: TaskReminderSchedule }>(`/tasks/${encodeURIComponent(taskId)}/reminder-schedule`).then((r) => r.data),
    saveTaskSchedule: (taskId: string, scheduleId: string | null) =>
      client.put<{ data: TaskReminderSchedule }>(`/tasks/${encodeURIComponent(taskId)}/reminder-schedule`, { scheduleId }).then((r) => r.data),
  };
}
