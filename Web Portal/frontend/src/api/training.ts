import type { ApiClient } from '../lib/api-client';

/**
 * Training Center (GET/PUT/POST /training/...): My training, the catalogue, courses, lessons, quizzes,
 * certificates and feedback for staff; the Training Center (courses, assignments, onboarding rules, feedback,
 * reports, settings) for Training managers and administrators. The Client portal's calls are in api/portal.ts.
 *
 * Between the two markers: an exact copy of the server's `modules/training/training-types.ts` (after its
 * header comment) - training-types-copy.test.ts compares them.
 */

// <training-types>
export const TRAINING_MODULES = [
  'tasks',
  'board',
  'meetings',
  'calendar',
  'projects',
  'reports',
  'management',
  'chat',
  'mico-ai',
  'admin',
  'portal',
  'training',
  'general',
] as const;
export type TrainingModule = (typeof TRAINING_MODULES)[number];

export const MODULE_LABELS: Readonly<Record<TrainingModule, string>> = {
  tasks: 'Tasks',
  board: 'Kanban board',
  meetings: 'Meetings & minutes',
  calendar: 'Calendar',
  projects: 'Projects',
  reports: 'Reports',
  management: 'Management',
  chat: 'Chat',
  'mico-ai': 'MICO AI',
  admin: 'Admin settings',
  portal: 'Client portal',
  training: 'Learning Hub',
  general: 'General',
};

export const AUDIENCES = ['STAFF', 'CLIENTS'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Staff groups a course can be meant for (empty: everyone in the audience). */
export const ROLE_KEYS = ['admins', 'employees', 'project-runners', 'training-managers'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Group targets of an assignment or onboarding rule. */
export const GROUP_KEYS = ['everyone', 'admins', 'employees', 'clients', 'project-runners', 'training-managers'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABELS: Readonly<Record<GroupKey, string>> = {
  everyone: 'Everyone (all staff)',
  admins: 'Administrators',
  employees: 'Employees',
  clients: 'Clients',
  'project-runners': 'People who run a project',
  'training-managers': 'Training managers',
};

export const DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const COMPLETION_RULES = ['ALL_LESSONS', 'QUIZZES'] as const;
export type CompletionRule = (typeof COMPLETION_RULES)[number];

export const LESSON_KINDS = ['VIDEO', 'GUIDE', 'DOCUMENT', 'QUIZ'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const QUESTION_KINDS = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'ORDER'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const TARGET_KINDS = ['USER', 'GROUP', 'DEPARTMENT', 'COMPANY', 'PROJECT'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** What the Assign form offers; PEOPLE is several ticked people, stored as USER rows sharing a batchId. */
export const ASSIGN_TARGET_KINDS = ['USER', 'GROUP', 'DEPARTMENT', 'COMPANY', 'PROJECT', 'PEOPLE'] as const;

/** A module's state for one person in the one course. */
export const MODULE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE'] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export const RULE_TARGET_KINDS = ['GROUP', 'DEPARTMENT', 'COMPANY'] as const;
export type RuleTargetKind = (typeof RULE_TARGET_KINDS)[number];

export const FILE_KINDS = ['RESOURCE', 'DOCUMENT', 'IMAGE', 'SIGNATURE'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FEEDBACK_KINDS = ['RATING', 'QUESTION', 'OUTDATED'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ['OPEN', 'ANSWERED', 'FIXED'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const ENROLMENT_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'REVIEW', 'RETAKE'] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

export const CERTIFICATE_STATUSES = ['VALID', 'EXPIRED', 'REVOKED'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const REPORT_BY = ['course', 'person', 'department', 'role', 'company', 'project'] as const;
export type ReportBy = (typeof REPORT_BY)[number];

/** Reports "Dates by": when people got the training, or when they finished it. */
export const REPORT_DATES = ['got', 'finished'] as const;
export type ReportDates = (typeof REPORT_DATES)[number];

/** Notice types sent through the Notification & Scheduling engine (one "Training" Settings row). */
export const TRAINING_NOTICE_TYPES = [
  'TRAINING_ASSIGNED',
  'TRAINING_DUE_SOON',
  'TRAINING_OVERDUE',
  'TRAINING_EXPIRING',
  'TRAINING_QUESTION',
] as const;
export type TrainingNoticeType = (typeof TRAINING_NOTICE_TYPES)[number];

/** Lengths the API checks (the live database is MariaDB in non-strict mode: it would cut silently). */
export const LIMITS = {
  courseTitle: 160,
  courseSummary: 2000,
  lessonTitle: 160,
  lessonBody: 60_000,
  stepTitle: 160,
  stepBody: 20_000,
  stepsPerLesson: 60,
  imageAlt: 200,
  lessonsPerCourse: 80,
  videoUrl: 500,
  questionPrompt: 1000,
  questionExplanation: 1000,
  optionText: 300,
  optionFeedback: 500,
  optionsPerQuestion: 10,
  questionsPerQuiz: 100,
  issuerTitle: 120,
  ruleName: 120,
  feedbackBody: 2000,
  feedbackAnswer: 4000,
  revokeReason: 200,
  fileName: 180,
  search: 100,
  /** Training documents and downloads (the owner's 16.7 MB Meetings PDF fits); pictures 10 MB. */
  documentBytes: 25 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  minutesMax: 600,
  certificateMonthsMax: 120,
  dueDaysMax: 365,
  reviewDaysMax: 180,
  timeLimitMax: 240,
  maxAttemptsMax: 50,
  moduleTitle: 160,
  modulesPerCourse: 30,
  peoplePerAssignment: 200,
} as const;

// ── Shapes the API answers with ──────────────────────────────────────────────────────────────────────

export interface FileRef {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: FileKind;
}

export interface CertificateRef {
  id: string;
  code: string;
  courseId: string;
  courseTitle: string;
  issuedAt: string;
  expiresAt: string | null;
  status: CertificateStatus;
  /** When the person finished the course (the certificate's date line). */
  completedAt: string;
  learnerName: string;
  verifyUrl: string;
}

/** The person's own state on a course (none yet: NOT_STARTED, enrolled false). */
export interface MyCourseState {
  enrolled: boolean;
  status: EnrolmentStatus;
  progressPct: number;
  /** Given by an assignment (mandatory ones say so). */
  assigned: boolean;
  mandatory: boolean;
  /** 'YYYY-MM-DD' (the review's or the retake's due day while those are on). */
  dueDay: string | null;
  overdue: boolean;
  lastLessonId: string | null;
  /** The lesson Start / Continue opens: the first one to do (to review), else the first; null: no lessons. */
  nextLessonId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  certificate: CertificateRef | null;
  lessonsDone: number;
  /** Modules done of those the person sees; null for a course without modules. */
  modules: { done: number; total: number } | null;
  /** Modules new for the person's role since they last finished (D3 never undoes completion). */
  newForRole: number;
  /** What Continue opens. */
  next: { lessonId: string; lessonTitle: string; moduleTitle: string | null } | null;
}

export interface CourseCard {
  id: string;
  title: string;
  summary: string | null;
  moduleKey: TrainingModule;
  audience: Audience;
  difficulty: Difficulty;
  /** Sum of the lessons' minutes. */
  minutes: number;
  lessonCount: number;
  certificateOn: boolean;
  starter: boolean;
  rating: { average: number | null; count: number };
  mine: MyCourseState;
}

export interface MyTraining {
  counts: { assigned: number; inProgress: number; notStarted: number; completed: number; overdue: number; review: number };
  /** Assigned and not completed: mandatory first, then by due day. */
  assigned: CourseCard[];
  /** Started by themselves (not assigned), not completed. */
  inProgress: CourseCard[];
  completed: CourseCard[];
  certificates: CertificateRef[];
  /**
   * 1.23.34: the built-in course (staff: MICO360 Tasks User Training; the Client portal: Client portal basics) offered
   * to someone who hasn't finished it and doesn't have it on the lists above: optional — not assigned, no due day, not
   * in the counts. Null: finished, already listed, assigned, or not published / not theirs. The website shows it as
   * Up next only when nothing else is open.
   */
  suggested: CourseCard | null;
}

export interface LessonOutline {
  id: string;
  position: number;
  kind: LessonKind;
  title: string;
  minutes: number;
  done: boolean;
  /** inOrder and an earlier lesson isn't done. */
  locked: boolean;
  /** Changed by a Major change since they finished: review it. */
  review: boolean;
  moduleId: string | null;
}

export interface ModuleOutline {
  id: string;
  title: string;
  /** The feature it teaches (its icon on the learner's pages); null for "Other lessons". */
  moduleKey: TrainingModule | null;
  position: number;
  status: ModuleStatus;
  lessonsDone: number;
  lessonCount: number;
  minutes: number;
  doneAt: string | null;
  newForRole: boolean;
  nextLessonId: string | null;
  lessonIds: string[];
}

export interface QuestionAndAnswer {
  id: string;
  question: string;
  answer: string | null;
  askedAt: string;
  answeredAt: string | null;
  /** Asked by the viewer (their own open questions show too). */
  mine: boolean;
}

export interface CourseDetail extends CourseCard {
  completionRule: CompletionRule;
  inOrder: boolean;
  version: number;
  certificateMonths: number | null;
  lessons: LessonOutline[];
  /** The modules the person sees, in order; [] for a course without modules. */
  modules: ModuleOutline[];
  resources: FileRef[];
  questions: QuestionAndAnswer[];
  myRating: number | null;
  /** The lesson "Resume" opens (the first not done, else the first). */
  resumeLessonId: string | null;
}

export interface VideoInfo {
  provider: 'YOUTUBE' | 'VIMEO';
  videoId: string;
  /** youtube-nocookie.com/embed/… or player.vimeo.com/video/… (no parameters: the player adds its own). */
  embedUrl: string;
  /** The link to open it outside (shown when the player can't load). */
  watchUrl: string;
}

export interface LessonStep {
  id: string;
  position: number;
  title: string | null;
  /** Server-cleaned rich text. */
  body: string | null;
  image: { fileId: string; alt: string | null } | null;
}

export interface QuizInfo {
  passMark: number;
  /** null: unlimited. */
  maxAttempts: number | null;
  attemptsUsed: number;
  timeLimitMinutes: number | null;
  /** Questions in one attempt (the bank's draw count when set). */
  questionCount: number;
  best: { scorePct: number; passed: boolean } | null;
  /** An attempt started and not handed in (resume it). */
  openAttemptId: string | null;
  /** The last handed-in attempt (its result can be read). */
  lastAttemptId: string | null;
  canStart: boolean;
  /** Why not (no attempts left). */
  reason: string | null;
}

export interface LessonView {
  id: string;
  courseId: string;
  courseTitle: string;
  kind: LessonKind;
  title: string;
  minutes: number;
  position: number;
  lessonCount: number;
  body: string | null;
  prevLessonId: string | null;
  nextLessonId: string | null;
  /** VIDEO with a link; null when the link is missing (shown as "Video coming soon"). */
  video: VideoInfo | null;
  steps: LessonStep[];
  document: FileRef | null;
  quiz: QuizInfo | null;
  progress: { done: boolean; videoSeconds: number; watchedPct: number; stepIndex: number };
  courseProgressPct: number;
  /** "Mark as watched" may be used after this many seconds on the lesson (no player events). */
  watchFallbackSeconds: number;
  module: { id: string; title: string; lessonIndex: number; lessonCount: number } | null;
}

export interface LessonDone {
  courseProgressPct: number;
  courseCompleted: boolean;
  certificateId: string | null;
  nextLessonId: string | null;
  /** The module this lesson just finished, when it did. */
  moduleDone: { id: string; title: string } | null;
}

export interface PaperQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  /** Option order as drawn for this attempt; never says which are right. */
  options: { id: string; text: string }[];
}

export interface AttemptPaper {
  id: string;
  lessonId: string;
  courseId: string;
  startedAt: string;
  deadlineAt: string | null;
  questions: PaperQuestion[];
  /** The draft saved so far. */
  answers: Record<string, string[]>;
}

export interface AttemptResultQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  right: boolean;
  chosen: string[];
  /**
   * In the drawn order. Always: the chosen answers' feedback. Only when the attempt's `answersShown`: which are
   * `correct`, the other answers' feedback and (ORDER) position = the right place; before that `correct` is false
   * and position is the order handed out.
   */
  options: { id: string; text: string; correct: boolean; position: number; feedback: string | null }[];
  explanation: string | null;
}

export interface AttemptResult {
  id: string;
  lessonId: string;
  courseId: string;
  submittedAt: string;
  scorePct: number;
  passed: boolean;
  passMark: number;
  /** null: unlimited. */
  attemptsLeft: number | null;
  /** Handed in by the server after the time limit. */
  timedOut: boolean;
  /** M9: the right answers and explanations are shown (the quiz is passed, or no attempts are left). */
  answersShown: boolean;
  questions: AttemptResultQuestion[];
  courseCompleted: boolean;
  certificateId: string | null;
  moduleDone: { id: string; title: string } | null;
}

export interface FeedbackItem {
  id: string;
  courseId: string;
  courseTitle: string;
  lessonId: string | null;
  lessonTitle: string | null;
  kind: FeedbackKind;
  rating: number | null;
  body: string | null;
  status: FeedbackStatus;
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
  /** Shown to Training managers only. */
  byName: string | null;
}

export interface VerifyResult {
  courseTitle: string;
  learnerName: string;
  issuedAt: string;
  expiresAt: string | null;
  status: CertificateStatus;
  completedAt: string;
}

export interface TrainingAccess {
  learner: boolean;
  /** Training manager or administrator: the Training Center. */
  manager: boolean;
  admin: boolean;
  /** Runs a project (not a manager): Reports for their team, read-only. */
  teamReports: boolean;
  /** Mandatory or assigned courses past their due day (the red badge). */
  overdue: number;
  assigned: number;
  tour: { show: boolean };
}

export interface PortalTraining extends MyTraining {
  catalogue: CourseCard[];
  tour: { show: boolean };
}

// ── Training Center (managers) ────────────────────────────────────────────────────────────────────────

export interface ManageCourseRow {
  id: string;
  title: string;
  moduleKey: TrainingModule;
  audience: Audience;
  difficulty: Difficulty;
  status: CourseStatus;
  starter: boolean;
  version: number;
  lessonCount: number;
  minutes: number;
  enrolled: number;
  completed: number;
  /** Lessons edited since the last publish (Publish asks Minor fix / Major change). */
  unpublishedChanges: boolean;
  updatedAt: string;
  notice: string | null;
  /** Who it is limited to, in words; null: everyone it is meant for. */
  limitedTo: string | null;
  everPublished: boolean;
  moduleCount: number;
}

export interface ManageOption {
  id: string;
  text: string;
  correct: boolean;
  feedback: string | null;
}

export interface ManageQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  explanation: string | null;
  options: ManageOption[];
}

export interface ManageQuiz {
  passMark: number;
  maxAttempts: number | null;
  shuffle: boolean;
  timeLimitMinutes: number | null;
  drawCount: number | null;
  questions: ManageQuestion[];
}

export interface ManageLesson {
  id: string;
  position: number;
  kind: LessonKind;
  title: string;
  minutes: number;
  body: string | null;
  videoUrl: string | null;
  video: VideoInfo | null;
  document: FileRef | null;
  steps: LessonStep[];
  quiz: ManageQuiz | null;
  changedVersion: number;
  moduleId: string | null;
}

export interface ManageModule {
  id: string;
  title: string;
  position: number;
  moduleKey: TrainingModule;
  roleKeys: RoleKey[];
  companyIds: string[];
  enabled: boolean;
  offReason: 'REMOVED' | null;
  starter: boolean;
  /** Who sees it, in words (visibilityWords). */
  visibility: string;
}

export interface ModuleInput {
  title: string;
  moduleKey?: TrainingModule;
  roleKeys?: RoleKey[];
  companyIds?: string[];
  enabled?: boolean;
}

/** Batch 4b: before a lesson is deleted — how many people it would finish now, and whether they get a certificate. */
export interface LessonDeleteImpact {
  finishing: number;
  certificate: boolean;
  published: boolean;
}

export interface ManageCourse {
  id: string;
  title: string;
  summary: string | null;
  moduleKey: TrainingModule;
  audience: Audience;
  roleKeys: RoleKey[];
  difficulty: Difficulty;
  status: CourseStatus;
  completionRule: CompletionRule;
  inOrder: boolean;
  certificateOn: boolean;
  certificateMonths: number | null;
  issuerUserId: string | null;
  issuerTitle: string | null;
  signature: FileRef | null;
  companyIds: string[];
  version: number;
  starter: boolean;
  publishedAt: string | null;
  unpublishedChanges: boolean;
  lessons: ManageLesson[];
  modules: ManageModule[];
  notice: string | null;
  resources: FileRef[];
  /** Why Publish is refused today (e.g. a video lesson without its link); empty: ready. */
  publishProblems: string[];
  enrolled: number;
  completed: number;
}

export interface TargetOptions {
  groups: { key: GroupKey; label: string }[];
  people: { id: string; name: string; email: string; client: boolean }[];
  departments: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  projects: { id: string; name: string; code: string | null }[];
  /** Who can sign certificates: Training managers and administrators. */
  issuers: { id: string; name: string }[];
}

export interface AssignmentRow {
  id: string;
  courseId: string;
  courseTitle: string;
  targetKind: TargetKind | 'PEOPLE';
  targetId: string;
  targetLabel: string;
  mandatory: boolean;
  dueDay: string | null;
  dueDays: number | null;
  ruleId: string | null;
  batchId: string | null;
  /** The people of a PEOPLE assignment (one row each). */
  members: { assignmentId: string; userId: string; name: string }[];
  people: number;
  completed: number;
  overdue: number;
  createdAt: string;
  createdByName: string | null;
  frozen: boolean;
}

export interface RuleRow {
  id: string;
  name: string;
  targetKind: RuleTargetKind;
  targetId: string;
  targetLabel: string;
  courseIds: string[];
  courseTitles: string[];
  mandatory: boolean;
  dueDays: number | null;
  active: boolean;
  createdAt: string;
  people: number;
}

export interface ReportRow {
  key: string;
  label: string;
  /** People with the course(s) (assigned or started). */
  people: number;
  assigned: number;
  started: number;
  completed: number;
  overdue: number;
  /** completed ÷ people × 100 (rounded); null when nobody. */
  completionRate: number | null;
  /** Average best quiz score (percent) of those who took one; null: none. */
  averageScore: number | null;
  /** Enrolments (a person can have several); people = distinct persons. */
  enrolments: number;
  selfStarted: number;
}

export interface ModuleReportRow {
  moduleId: string;
  title: string;
  people: number;
  done: number;
  inProgress: number;
  notStarted: number;
}

export interface ModuleLearnerRow {
  userId: string;
  name: string;
  modulesDone: number;
  modulesRequired: number;
  lastActivityAt: string | null;
  certificate: { id: string; code: string } | null;
}

export interface TrainingReport {
  /** ALL (administrators), COMPANIES (a Training manager's), TEAM (a project manager's team). */
  scope: 'ALL' | 'COMPANIES' | 'TEAM';
  by: ReportBy;
  dates: ReportDates;
  totals: ReportRow;
  rows: ReportRow[];
  overdue: { userId: string; name: string; courseId: string; courseTitle: string; dueDay: string; daysLate: number; mandatory: boolean; client: boolean }[];
  expiring: { certificateId: string; userId: string; name: string; courseId: string; courseTitle: string; expiresAt: string }[];
  quizzes: {
    lessonId: string;
    courseTitle: string;
    title: string;
    attempts: number;
    passRate: number | null;
    averageScore: number | null;
    people: number;
    moduleTitle: string | null;
    questions: number;
  }[];
  /** Per module of the one course; null for other reports. */
  modules: ModuleReportRow[] | null;
  /** Per person of the one course; null for other reports. */
  learners: ModuleLearnerRow[] | null;
}

export interface QuizReport {
  lessonId: string;
  courseTitle: string;
  title: string;
  attempts: number;
  people: number;
  passRate: number | null;
  averageScore: number | null;
  questions: { id: string; prompt: string; answered: number; rightPct: number | null }[];
}

export interface TrainingSettings {
  tourOff: string[];
  companies: { id: string; name: string }[];
}
// </training-types>

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────────────

export interface CourseInput {
  title: string;
  summary?: string | null;
  moduleKey: TrainingModule;
  audience: Audience;
  roleKeys?: RoleKey[];
  difficulty: Difficulty;
  completionRule?: CompletionRule;
  inOrder?: boolean;
  certificateOn?: boolean;
  certificateMonths?: number | null;
  issuerUserId?: string | null;
  issuerTitle?: string | null;
  signatureFileId?: string | null;
  companyIds?: string[];
}

export interface LessonInput {
  kind: LessonKind;
  title: string;
  minutes?: number;
  body?: string | null;
  /** VIDEO: a YouTube or Vimeo link (normalised by the server; anything else is refused). */
  videoUrl?: string | null;
  /** DOCUMENT: a file uploaded to the course with kind DOCUMENT. */
  fileId?: string | null;
  /** 1.23.32: a module of the course the new lesson goes into (last in it); null or not sent: no module. */
  moduleId?: string | null;
}

/** PATCH /training/manage/lessons/:id: the lesson's fields, and the module it belongs to (null: no module; it goes last in its new module). */
export type LessonPatch = Partial<LessonInput> & { moduleId?: string | null };

/** The Courses list's filters (applied on the server). */
export interface ManageCourseFilters {
  status?: CourseStatus | '';
  module?: TrainingModule | '';
  q?: string;
  audience?: Audience | '';
}

export interface StepInput {
  title?: string | null;
  body?: string | null;
  imageFileId?: string | null;
  imageAlt?: string | null;
}

export interface QuizInput {
  passMark: number;
  maxAttempts: number | null;
  shuffle: boolean;
  timeLimitMinutes: number | null;
  drawCount: number | null;
  questions: {
    kind: QuestionKind;
    prompt: string;
    explanation?: string | null;
    options: { text: string; correct: boolean; feedback?: string | null }[];
  }[];
}

export interface AssignmentInput {
  courseIds: string[];
  /** PEOPLE: several ticked people (userIds, no targetId). */
  targetKind: TargetKind | 'PEOPLE';
  targetId?: string;
  userIds?: string[];
  mandatory: boolean;
  dueDay?: string | null;
  dueDays?: number | null;
  /** A group, department or company: only people who join from now on (an onboarding rule underneath). */
  newStaffOnly?: boolean;
}

export interface RuleInput {
  name: string;
  targetKind: RuleTargetKind;
  targetId: string;
  courseIds: string[];
  mandatory: boolean;
  dueDays: number | null;
  active?: boolean;
}

export interface CatalogueFilters {
  module?: TrainingModule | '';
  difficulty?: Difficulty | '';
  q?: string;
}

export interface ReportQuery {
  by: ReportBy;
  courseId?: string;
  from?: string;
  to?: string;
  /** Dates by: the day people got the course (default) or the day they finished it. */
  dates?: ReportDates;
}

export interface ManageCertificateRow extends CertificateRef {
  userId: string;
  learnerName: string;
}

const enc = encodeURIComponent;
const qs = (params: Record<string, string | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** The same file path for every training file kind (the server checks the course's audience). */
export const trainingFilePath = (fileId: string): string => `/training/files/${enc(fileId)}`;

export function trainingApi(client: ApiClient) {
  const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);
  return {
    // ── learner ──
    access: () => data(client.get<{ data: TrainingAccess }>('/training/access')),
    me: () => data(client.get<{ data: MyTraining }>('/training/me')),
    catalogue: (f: CatalogueFilters = {}) =>
      data(client.get<{ data: { courses: CourseCard[] } }>(`/training/catalogue${qs({ module: f.module, difficulty: f.difficulty, q: f.q })}`)),
    learn: (module: TrainingModule) =>
      data(client.get<{ data: { courseId: string | null; moduleId: string | null; module: TrainingModule; count: number } }>(`/training/learn${qs({ module })}`)),
    course: (id: string) => data(client.get<{ data: CourseDetail }>(`/training/courses/${enc(id)}`)),
    start: (id: string) => data(client.post<{ data: CourseDetail }>(`/training/courses/${enc(id)}/start`)),
    lesson: (id: string) => data(client.get<{ data: LessonView }>(`/training/lessons/${enc(id)}`)),
    saveProgress: (id: string, p: { videoSeconds?: number; videoDuration?: number; watchedPct?: number; stepIndex?: number }) =>
      data(client.put<{ data: { ok: true; progressPct: number } }>(`/training/lessons/${enc(id)}/progress`, p)),
    complete: (id: string) => data(client.post<{ data: LessonDone }>(`/training/lessons/${enc(id)}/complete`)),
    startAttempt: (lessonId: string) => data(client.post<{ data: AttemptPaper }>(`/training/lessons/${enc(lessonId)}/attempts`)),
    saveAnswers: (attemptId: string, answers: Record<string, string[]>) =>
      data(client.put<{ data: { savedAt: string } }>(`/training/attempts/${enc(attemptId)}`, { answers })),
    submit: (attemptId: string, answers?: Record<string, string[]>) =>
      data(client.post<{ data: AttemptResult }>(`/training/attempts/${enc(attemptId)}/submit`, answers ? { answers } : {})),
    result: (attemptId: string) => data(client.get<{ data: AttemptResult }>(`/training/attempts/${enc(attemptId)}`)),
    file: (fileId: string) => client.getBlob(trainingFilePath(fileId)),
    certificatePdf: (certificateId: string) => client.getBlob(`/training/certificates/${enc(certificateId)}/pdf`),
    feedback: (courseId: string, f: { kind: FeedbackKind; rating?: number; body?: string; lessonId?: string | null }) =>
      data(client.post<{ data: FeedbackItem }>(`/training/courses/${enc(courseId)}/feedback`, f)),
    tourDone: () => data(client.put<{ data: { ok: true } }>('/training/tour', { done: true })),
    verify: (code: string) => data(client.get<{ data: VerifyResult }>(`/training/verify/${enc(code)}`)),

    // ── Training Center ──
    courses: (f: ManageCourseFilters = {}) =>
      data(client.get<{ data: { courses: ManageCourseRow[] } }>(`/training/manage/courses${qs({ status: f.status, module: f.module, q: f.q, audience: f.audience })}`)),
    createCourse: (input: CourseInput) => data(client.post<{ data: ManageCourse }>('/training/manage/courses', input)),
    manageCourse: (id: string) => data(client.get<{ data: ManageCourse }>(`/training/manage/courses/${enc(id)}`)),
    updateCourse: (id: string, patch: Partial<CourseInput>) => data(client.patch<{ data: ManageCourse }>(`/training/manage/courses/${enc(id)}`, patch)),
    deleteCourse: (id: string) => client.del(`/training/manage/courses/${enc(id)}`),
    publish: (id: string, change?: { change: 'MINOR' | 'MAJOR'; reviewDays?: number }) =>
      data(client.post<{ data: ManageCourse }>(`/training/manage/courses/${enc(id)}/publish`, change ?? {})),
    unpublish: (id: string) => data(client.post<{ data: ManageCourse }>(`/training/manage/courses/${enc(id)}/unpublish`)),
    archive: (id: string) => data(client.post<{ data: ManageCourse }>(`/training/manage/courses/${enc(id)}/archive`)),
    /** A draft "Copy of …" with its modules, lessons, quiz and pictures (no progress, assignments, certificates or feedback). */
    duplicateCourse: (id: string) => data(client.post<{ data: ManageCourse }>(`/training/manage/courses/${enc(id)}/duplicate`)),
    addModule: (courseId: string, input: ModuleInput) =>
      data(client.post<{ data: ManageCourse }>(`/training/manage/courses/${enc(courseId)}/modules`, input)),
    updateModule: (id: string, patch: Partial<ModuleInput>) => data(client.patch<{ data: ManageCourse }>(`/training/manage/modules/${enc(id)}`, patch)),
    /** Its lessons move to `moveTo` (a module of the same course) or to no module; lessons are never deleted. */
    removeModule: (id: string, moveTo: string | null) =>
      data(client.post<{ data: ManageCourse }>(`/training/manage/modules/${enc(id)}/remove`, { moveTo })),
    reorderModules: (courseId: string, moduleIds: string[]) =>
      data(client.put<{ data: ManageCourse }>(`/training/manage/courses/${enc(courseId)}/module-order`, { moduleIds })),
    addLesson: (courseId: string, input: LessonInput) =>
      data(client.post<{ data: ManageLesson }>(`/training/manage/courses/${enc(courseId)}/lessons`, input)),
    updateLesson: (id: string, patch: LessonPatch) => data(client.patch<{ data: ManageLesson }>(`/training/manage/lessons/${enc(id)}`, patch)),
    deleteLesson: (id: string) => client.del(`/training/manage/lessons/${enc(id)}`),
    /** Batch 4b: how many people deleting this lesson would finish (and certify) now; nothing is changed. */
    lessonDeleteImpact: (id: string) => data(client.get<{ data: LessonDeleteImpact }>(`/training/manage/lessons/${enc(id)}/delete-impact`)),
    reorderLessons: (courseId: string, lessonIds: string[]) =>
      data(client.put<{ data: ManageCourse }>(`/training/manage/courses/${enc(courseId)}/lesson-order`, { lessonIds })),
    saveSteps: (lessonId: string, steps: StepInput[]) => data(client.put<{ data: ManageLesson }>(`/training/manage/lessons/${enc(lessonId)}/steps`, { steps })),
    saveQuiz: (lessonId: string, quiz: QuizInput) => data(client.put<{ data: ManageLesson }>(`/training/manage/lessons/${enc(lessonId)}/quiz`, quiz)),
    uploadFile: (courseId: string, kind: 'RESOURCE' | 'DOCUMENT' | 'IMAGE', file: File, onProgress?: (f: number) => void) => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      return data(client.upload<{ data: FileRef }>(`/training/manage/courses/${enc(courseId)}/files`, form, { onProgress }));
    },
    deleteFile: (fileId: string) => client.del(`/training/manage/files/${enc(fileId)}`),
    uploadSignature: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return data(client.upload<{ data: FileRef }>('/training/manage/signatures', form));
    },
    options: () => data(client.get<{ data: TargetOptions }>('/training/manage/options')),
    assignments: (courseId?: string) => data(client.get<{ data: { assignments: AssignmentRow[] } }>(`/training/manage/assignments${qs({ courseId })}`)),
    previewAssignment: (input: AssignmentInput) =>
      data(client.post<{ data: { reach: number; already: number; skipped: { name: string; reason: string }[] } }>('/training/manage/assignments/preview', input)),
    assign: (input: AssignmentInput) => data(client.post<{ data: { assignments: AssignmentRow[] } }>('/training/manage/assignments', input)),
    withdraw: (id: string) => client.del(`/training/manage/assignments/${enc(id)}`),
    withdrawBatch: (batchId: string) => client.del(`/training/manage/assignment-batches/${enc(batchId)}`),
    rules: () => data(client.get<{ data: { rules: RuleRow[] } }>('/training/manage/rules')),
    createRule: (input: RuleInput) => data(client.post<{ data: RuleRow }>('/training/manage/rules', input)),
    updateRule: (id: string, patch: Partial<RuleInput>) => data(client.patch<{ data: RuleRow }>(`/training/manage/rules/${enc(id)}`, patch)),
    deleteRule: (id: string) => client.del(`/training/manage/rules/${enc(id)}`),
    feedbackList: (f: { kind?: FeedbackKind | ''; status?: FeedbackStatus | '' } = {}) =>
      data(client.get<{ data: { items: FeedbackItem[] } }>(`/training/manage/feedback${qs({ kind: f.kind, status: f.status })}`)),
    answer: (id: string, answer: string) => data(client.post<{ data: FeedbackItem }>(`/training/manage/feedback/${enc(id)}/answer`, { answer })),
    markFixed: (id: string) => data(client.post<{ data: FeedbackItem }>(`/training/manage/feedback/${enc(id)}/fixed`)),
    certificates: (f: { courseId?: string; q?: string } = {}) =>
      data(client.get<{ data: { certificates: ManageCertificateRow[] } }>(`/training/manage/certificates${qs({ courseId: f.courseId, q: f.q })}`)),
    revoke: (id: string, reason: string) => data(client.post<{ data: CertificateRef }>(`/training/manage/certificates/${enc(id)}/revoke`, { reason })),
    report: (q: ReportQuery) => data(client.get<{ data: TrainingReport }>(`/training/reports${qs({ by: q.by, courseId: q.courseId, from: q.from, to: q.to, dates: q.dates })}`)),
    quizReport: (lessonId: string) => data(client.get<{ data: QuizReport }>(`/training/reports/quiz/${enc(lessonId)}`)),
    reportFile: (q: ReportQuery, format: 'xlsx' | 'pdf') =>
      client.getBlob(`/training/reports/export.${format}${qs({ by: q.by, courseId: q.courseId, from: q.from, to: q.to, dates: q.dates })}`),
    settings: () => data(client.get<{ data: TrainingSettings }>('/training/settings')),
    saveSettings: (s: { tourOff: string[] }) => data(client.put<{ data: TrainingSettings }>('/training/settings', s)),
  };
}

export type TrainingApi = ReturnType<typeof trainingApi>;
