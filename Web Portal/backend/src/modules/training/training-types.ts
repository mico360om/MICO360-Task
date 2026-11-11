/**
 * Training Center (owner, 11 Nov 2026): the shared words, limits and the shapes the API answers with.
 * The website keeps a copy of these shapes in `frontend/src/api/training.ts` (training-types-copy.test.ts
 * compares the constant lists). Rulings: .superpowers/train/progress.md.
 */

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
  training: 'Training Center',
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
  startedAt: string | null;
  completedAt: string | null;
  certificate: CertificateRef | null;
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
}

export interface LessonDone {
  courseProgressPct: number;
  courseCompleted: boolean;
  certificateId: string | null;
  nextLessonId: string | null;
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
  /** In the drawn order; `correct` and feedback are revealed after hand-in. ORDER: position = the right place. */
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
  questions: AttemptResultQuestion[];
  courseCompleted: boolean;
  certificateId: string | null;
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
  targetKind: TargetKind;
  targetId: string;
  targetLabel: string;
  mandatory: boolean;
  dueDay: string | null;
  dueDays: number | null;
  ruleId: string | null;
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
}

export interface TrainingReport {
  /** ALL (administrators), COMPANIES (a Training manager's), TEAM (a project manager's team). */
  scope: 'ALL' | 'COMPANIES' | 'TEAM';
  by: ReportBy;
  totals: ReportRow;
  rows: ReportRow[];
  overdue: { userId: string; name: string; courseId: string; courseTitle: string; dueDay: string; daysLate: number; mandatory: boolean; client: boolean }[];
  expiring: { certificateId: string; userId: string; name: string; courseId: string; courseTitle: string; expiresAt: string }[];
  quizzes: { lessonId: string; courseTitle: string; title: string; attempts: number; passRate: number | null; averageScore: number | null }[];
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
