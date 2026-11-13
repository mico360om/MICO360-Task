import type { Audience, CompletionRule, Difficulty, QuestionKind, RoleKey, TrainingModule } from '../training-types';

/**
 * Starter content (owner answer 3): one English course per main module, loaded once by the server
 * (training-starter.ts) and marked with its `key` (training_courses.starterKey) so administrators can tell
 * it apart and edit or unpublish it. Pictures and downloads are files in `backend/assets/training/starter/`
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
 */
export type StarterLesson =
  | { kind: 'GUIDE'; title: string; was?: string[]; minutes: number; body?: string; steps: StarterStep[] }
  | { kind: 'VIDEO'; title: string; was?: string[]; minutes: number; body?: string; /** Hidden from learners until an administrator pastes the YouTube/Vimeo link (R2). */ videoUrl: null }
  | {
      kind: 'QUIZ';
      title: string;
      was?: string[];
      minutes: number;
      body?: string;
      quiz: { passMark: number; maxAttempts: number | null; shuffle: boolean; timeLimitMinutes: number | null; drawCount: number | null; questions: StarterQuestion[] };
    };

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
  lessons: StarterLesson[];
}
