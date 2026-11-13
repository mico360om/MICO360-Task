import type { Audience, CompletionRule, Difficulty, QuestionKind, RoleKey, TrainingModule } from '../training-types';

/**
 * Starter content (owner answer 3): English courses loaded once by the server (training-starter.ts) and marked
 * with their `key` (training_courses.starterKey) so administrators can tell them apart and edit or unpublish them.
 * Since 1.23.30 a course can be made of modules (`modules`; each lesson names its own): the staff's one course,
 * "MICO360 Tasks User Training", has one per part of the site. Pictures and downloads are files in `backend/assets/training/starter/`
 * (WebP screenshots taken from the real website), copied into the private training folder when loaded.
 * A course can also list downloads (`resources`); none does since 1.23.25.
 */
export interface StarterStep {
  title: string;
  /** Simple rich text: <p>, <strong>, <em>, <ul>/<ol>/<li> only (the server cleans it again). */
  body: string;
  /** A file name in assets/training/starter (e.g. 'tasks-01-my-tasks.webp'); none: a text-only step. */
  image?: string;
  /** What the picture shows (screen readers). Required when `image` is set. */
  alt?: string;
}

export interface StarterQuestion {
  kind: QuestionKind;
  prompt: string;
  explanation?: string;
  /** TRUE_FALSE: exactly [{text:'True'},{text:'False'}] with one correct. ORDER: in the right order (all correct: true). */
  options: { text: string; correct: boolean; feedback?: string }[];
}

/**
 * `was`: the lesson's titles in earlier starter revisions. A starter update (training-starter.ts, R1) finds an
 * untouched course's lessons by kind and title (or one of these), so people's progress on them is kept.
 * `module`: the key of the course's module it belongs to (a StarterModule key); none: no module.
 */
export type StarterLesson =
  | { kind: 'GUIDE'; title: string; was?: string[]; module?: string; minutes: number; body?: string; steps: StarterStep[] }
  | { kind: 'VIDEO'; title: string; was?: string[]; module?: string; minutes: number; body?: string; /** Hidden from learners until an administrator pastes the YouTube/Vimeo link (R2). */ videoUrl: null }
  | {
      kind: 'QUIZ';
      title: string;
      was?: string[];
      module?: string;
      minutes: number;
      body?: string;
      quiz: { passMark: number; maxAttempts: number | null; shuffle: boolean; timeLimitMinutes: number | null; drawCount: number | null; questions: StarterQuestion[] };
    };

/**
 * 1.23.30: a part of a built-in course (a training_modules row, found again by `key` in its starterKey). Who sees it
 * follows the feature it teaches and its staff groups, exactly as for a course (training-access.ts). Whether it is
 * switched on is the site's own (the conversion switches off a module whose short course was removed): a starter
 * update never changes it.
 */
export interface StarterModule {
  /** Stable and unique in its course: 'module:getting-started', 'module:tasks', ... (never change once shipped). */
  key: string;
  title: string;
  moduleKey: TrainingModule;
  /** Staff groups it is for; none: everyone the course is for. */
  roleKeys?: RoleKey[];
  /** The 1.23.27 short course it replaces (its starter key: the one-course conversion moves that course's lessons here). */
  from: string;
}

export interface StarterResource {
  /** A file name in assets/training/starter. */
  file: string;
  /** The name people see and download. */
  name: string;
  mimeType: 'application/pdf';
}

export interface StarterCourse {
  /** Stable and unique: 'starter:tasks', 'starter:video-tasks', ... (never change once shipped). */
  key: string;
  title: string;
  summary: string;
  moduleKey: TrainingModule;
  audience: Audience;
  roleKeys?: RoleKey[];
  difficulty: Difficulty;
  /** Every starter course is PUBLISHED (12 Nov: videos are lessons inside them, hidden until linked). */
  status: 'PUBLISHED' | 'DRAFT';
  /** Its place in All courses (default: its place in the list); Getting started comes first. */
  position?: number;
  completionRule: CompletionRule;
  certificateOn: boolean;
  certificateMonths: number | null;
  resources?: StarterResource[];
  /** Its modules, in order (their positions); none: a plain list of lessons, as before 1.23.30. */
  modules?: StarterModule[];
  lessons: StarterLesson[];
}
