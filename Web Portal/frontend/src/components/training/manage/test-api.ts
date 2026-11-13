import { vi, type Mock } from 'vitest';
import type {
  AssignmentRow,
  FeedbackItem,
  FileRef,
  ManageCertificateRow,
  ManageCourse,
  ManageCourseRow,
  ManageLesson,
  ManageQuiz,
  QuizReport,
  ReportRow,
  RuleRow,
  TargetOptions,
  TrainingAccess,
  TrainingApi,
  TrainingReport,
  TrainingSettings,
} from '../../../api/training';

/**
 * Test code only: a stand-in for the Training Center's API (api/training.ts trainingApi) with the shapes the
 * server answers (backend modules/training/training-types.ts), and fixtures to build answers from. A test mocks
 * the module so `trainingApi()` returns `fakeTrainingApi()`'s object, then checks what was called.
 */

export type FakeTrainingApi = { [K in keyof TrainingApi]: Mock<TrainingApi[K]> };

export const access = (over: Partial<TrainingAccess> = {}): TrainingAccess => ({
  learner: true,
  manager: true,
  admin: false,
  teamReports: false,
  overdue: 0,
  assigned: 0,
  tour: { show: false },
  ...over,
});

export const courseRow = (over: Partial<ManageCourseRow> & Pick<ManageCourseRow, 'id' | 'title'>): ManageCourseRow => ({
  moduleKey: 'tasks',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  starter: false,
  version: 1,
  lessonCount: 3,
  minutes: 25,
  enrolled: 10,
  completed: 4,
  unpublishedChanges: false,
  updatedAt: '2026-11-03T08:00:00.000Z',
  notice: null,
  limitedTo: null,
  everPublished: true,
  moduleCount: 0,
  ...over,
});

export const fileRef = (over: Partial<FileRef> & Pick<FileRef, 'id' | 'name'>): FileRef => ({ mimeType: 'application/pdf', sizeBytes: 2_400_000, kind: 'RESOURCE', ...over });

export const quiz = (over: Partial<ManageQuiz> = {}): ManageQuiz => ({ passMark: 70, maxAttempts: null, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [], ...over });

export const lesson = (over: Partial<ManageLesson> & Pick<ManageLesson, 'id' | 'kind' | 'title'>): ManageLesson => ({
  position: 0,
  minutes: 5,
  body: null,
  videoUrl: null,
  video: null,
  document: null,
  steps: [],
  quiz: over.kind === 'QUIZ' ? quiz() : null,
  changedVersion: 1,
  moduleId: null,
  ...over,
});

export const manageCourse = (over: Partial<ManageCourse> = {}): ManageCourse => ({
  id: 'c1',
  title: 'Tasks basics',
  summary: 'How to make and finish tasks.',
  moduleKey: 'tasks',
  audience: 'STAFF',
  roleKeys: [],
  difficulty: 'BEGINNER',
  status: 'DRAFT',
  completionRule: 'ALL_LESSONS',
  inOrder: false,
  certificateOn: false,
  certificateMonths: null,
  issuerUserId: null,
  issuerTitle: null,
  signature: null,
  companyIds: [],
  version: 1,
  starter: false,
  publishedAt: null,
  unpublishedChanges: false,
  lessons: [],
  modules: [],
  notice: null,
  resources: [],
  publishProblems: [],
  enrolled: 0,
  completed: 0,
  ...over,
});

export const OPTIONS: TargetOptions = {
  groups: [
    { key: 'everyone', label: 'Everyone (all staff)' },
    { key: 'employees', label: 'Employees' },
    { key: 'clients', label: 'Clients' },
  ],
  people: [
    { id: 'u-sam', name: 'Sam Shared', email: 'sam@x.co', client: false },
    { id: 'u-huda', name: 'Huda Client', email: 'huda@client.co', client: true },
  ],
  departments: [{ id: 'd-ops', name: 'Operations' }],
  companies: [
    { id: 'co-a', name: 'Alpha Co' },
    { id: 'co-b', name: 'Beta Co' },
  ],
  projects: [{ id: 'p-rig', name: 'Rig move', code: 'RIG' }],
  issuers: [
    { id: 'u-tm', name: 'Tara Trainer' },
    { id: 'u-admin', name: 'Khurram Admin' },
  ],
};

export const assignmentRow = (over: Partial<AssignmentRow> & Pick<AssignmentRow, 'id'>): AssignmentRow => ({
  courseId: 'c1',
  courseTitle: 'Tasks basics',
  targetKind: 'GROUP',
  targetId: 'everyone',
  targetLabel: 'Everyone (all staff)',
  mandatory: true,
  dueDay: null,
  dueDays: 14,
  ruleId: null,
  people: 12,
  completed: 5,
  overdue: 2,
  createdAt: '2026-11-03T08:00:00.000Z',
  createdByName: 'Tara Trainer',
  frozen: false,
  batchId: null,
  members: [],
  ...over,
});

export const ruleRow = (over: Partial<RuleRow> & Pick<RuleRow, 'id' | 'name'>): RuleRow => ({
  targetKind: 'GROUP',
  targetId: 'employees',
  targetLabel: 'Employees',
  courseIds: ['c1'],
  courseTitles: ['Tasks basics'],
  mandatory: true,
  dueDays: 14,
  active: true,
  createdAt: '2026-11-03T08:00:00.000Z',
  people: 4,
  ...over,
});

export const feedbackItem = (over: Partial<FeedbackItem> & Pick<FeedbackItem, 'id' | 'kind'>): FeedbackItem => ({
  courseId: 'c1',
  courseTitle: 'Tasks basics',
  lessonId: null,
  lessonTitle: null,
  rating: null,
  body: null,
  status: 'OPEN',
  answer: null,
  createdAt: '2026-11-03T08:00:00.000Z',
  answeredAt: null,
  byName: 'Sam Shared',
  ...over,
});

export const certificateRow = (over: Partial<ManageCertificateRow> & Pick<ManageCertificateRow, 'id'>): ManageCertificateRow => ({
  code: 'TC-ABCD-EFGH-JKLM',
  courseId: 'c1',
  courseTitle: 'Tasks basics',
  issuedAt: '2026-11-03T08:00:00.000Z',
  expiresAt: null,
  status: 'VALID',
  userId: 'u-sam',
  learnerName: 'Sam Shared',
  completedAt: '2026-11-03T08:00:00.000Z',
  verifyUrl: 'https://tasks.example.com/verify/TC-ABCD-EFGH-JKLM',
  ...over,
});

export const reportRow = (over: Partial<ReportRow> & Pick<ReportRow, 'key' | 'label'>): ReportRow => ({
  people: 10,
  assigned: 8,
  started: 6,
  completed: 4,
  overdue: 1,
  completionRate: 40,
  averageScore: 82,
  enrolments: 10,
  selfStarted: 2,
  ...over,
});

export const report = (over: Partial<TrainingReport> = {}): TrainingReport => ({
  scope: 'ALL',
  by: 'course',
  dates: 'got',
  totals: reportRow({ key: 'all', label: 'All' }),
  rows: [reportRow({ key: 'c1', label: 'Tasks basics' })],
  overdue: [{ userId: 'u-sam', name: 'Sam Shared', courseId: 'c1', courseTitle: 'Tasks basics', dueDay: '2026-11-01', daysLate: 4, mandatory: true, client: false }],
  expiring: [{ certificateId: 'cert1', userId: 'u-sam', name: 'Sam Shared', courseId: 'c1', courseTitle: 'Tasks basics', expiresAt: '2026-11-30T08:00:00.000Z' }],
  quizzes: [{ lessonId: 'l-quiz', courseTitle: 'Tasks basics', title: 'Check yourself', attempts: 9, passRate: 78, averageScore: 81, people: 9, moduleTitle: null, questions: 4 }],
  modules: null,
  learners: null,
  ...over,
});

export const quizReport = (over: Partial<QuizReport> = {}): QuizReport => ({
  lessonId: 'l-quiz',
  courseTitle: 'Tasks basics',
  title: 'Check yourself',
  attempts: 9,
  people: 7,
  passRate: 78,
  averageScore: 81,
  questions: [
    { id: 'q1', prompt: 'Where do new tasks go?', answered: 9, rightPct: 89 },
    { id: 'q2', prompt: 'Who can delete a task?', answered: 9, rightPct: 33 },
  ],
  ...over,
});

export const settings = (over: Partial<TrainingSettings> = {}): TrainingSettings => ({ tourOff: [], companies: [{ id: 'co-a', name: 'Alpha Co' }, { id: 'co-b', name: 'Beta Co' }], ...over });

const never = <T>() => new Promise<T>(() => {});

/** Every call answers like an empty, healthy server; a test overrides what it needs (mockResolvedValue…). */
export function fakeTrainingApi(): FakeTrainingApi {
  const course = manageCourse();
  const api: { [K in keyof TrainingApi]: unknown } = {
    access: vi.fn(async () => access()),
    me: vi.fn(() => never()),
    catalogue: vi.fn(async () => ({ courses: [] })),
    learn: vi.fn(async () => ({ courseId: null, module: 'tasks', count: 0 })),
    course: vi.fn(() => never()),
    start: vi.fn(() => never()),
    lesson: vi.fn(() => never()),
    saveProgress: vi.fn(() => never()),
    complete: vi.fn(() => never()),
    startAttempt: vi.fn(() => never()),
    saveAnswers: vi.fn(() => never()),
    submit: vi.fn(() => never()),
    result: vi.fn(() => never()),
    file: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
    certificatePdf: vi.fn(async () => new File(['%PDF'], 'certificate.pdf', { type: 'application/pdf' })),
    feedback: vi.fn(() => never()),
    tourDone: vi.fn(async () => ({ ok: true as const })),
    verify: vi.fn(() => never()),
    courses: vi.fn(async () => ({ courses: [] })),
    createCourse: vi.fn(async () => course),
    manageCourse: vi.fn(async () => course),
    updateCourse: vi.fn(async () => course),
    deleteCourse: vi.fn(async () => undefined),
    publish: vi.fn(async () => course),
    unpublish: vi.fn(async () => course),
    archive: vi.fn(async () => course),
    addLesson: vi.fn(async () => lesson({ id: 'l-new', kind: 'GUIDE', title: 'New' })),
    updateLesson: vi.fn(async () => lesson({ id: 'l1', kind: 'GUIDE', title: 'Lesson' })),
    deleteLesson: vi.fn(async () => undefined),
    reorderLessons: vi.fn(async () => course),
    saveSteps: vi.fn(async () => lesson({ id: 'l1', kind: 'GUIDE', title: 'Lesson' })),
    saveQuiz: vi.fn(async () => lesson({ id: 'l1', kind: 'QUIZ', title: 'Quiz' })),
    uploadFile: vi.fn(async () => fileRef({ id: 'f-new', name: 'file.pdf' })),
    deleteFile: vi.fn(async () => undefined),
    uploadSignature: vi.fn(async () => fileRef({ id: 'sig1', name: 'signature.png', kind: 'SIGNATURE', mimeType: 'image/png' })),
    options: vi.fn(async () => OPTIONS),
    assignments: vi.fn(async () => ({ assignments: [] })),
    previewAssignment: vi.fn(async () => ({ reach: 0, already: 0, skipped: [] })),
    assign: vi.fn(async () => ({ assignments: [] })),
    withdraw: vi.fn(async () => undefined),
    rules: vi.fn(async () => ({ rules: [] })),
    createRule: vi.fn(async () => ruleRow({ id: 'r-new', name: 'New rule' })),
    updateRule: vi.fn(async () => ruleRow({ id: 'r1', name: 'Rule' })),
    deleteRule: vi.fn(async () => undefined),
    feedbackList: vi.fn(async () => ({ items: [] })),
    answer: vi.fn(async () => feedbackItem({ id: 'fb', kind: 'QUESTION' })),
    markFixed: vi.fn(async () => feedbackItem({ id: 'fb', kind: 'OUTDATED', status: 'FIXED' })),
    certificates: vi.fn(async () => ({ certificates: [] })),
    revoke: vi.fn(async () => certificateRow({ id: 'cert', status: 'REVOKED' })),
    report: vi.fn(async () => report()),
    quizReport: vi.fn(async () => quizReport()),
    reportFile: vi.fn(async () => new File(['x'], 'training-report.xlsx')),
    settings: vi.fn(async () => settings()),
    saveSettings: vi.fn(async (s: { tourOff: string[] }) => settings({ tourOff: s.tourOff })),
  };
  return api as FakeTrainingApi;
}

/**
 * The mocked module's `trainingApi`: an object that always answers with the current fake's calls — so a module that
 * keeps the API object from import time (the learner side does) follows each test's fake too.
 */
export function followFake(current: () => FakeTrainingApi | null): () => TrainingApi {
  return () => new Proxy({} as TrainingApi, { get: (_t, key) => (current() as Record<string | symbol, unknown> | null)?.[key] });
}
