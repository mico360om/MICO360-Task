import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { apiClient } from '../../api/client';
import type { PortalApi, TrainingProgressInput } from '../../api/portal';
import { trainingApi, type AttemptPaper, type AttemptResult, type CourseDetail, type FeedbackItem, type FeedbackKind, type LessonDone, type LessonView } from '../../api/training';

/**
 * Taking a course: the same pages for staff (/training/…, the staff API) and for clients in the Client portal
 * (/portal/training/…, the portal's API). The course, lesson and quiz components read and write through a
 * LearnerApi — the learner half of trainingApi's names — given by the side they are on.
 */
export interface LearnerApi {
  course(id: string): Promise<CourseDetail>;
  start(id: string): Promise<CourseDetail>;
  lesson(id: string): Promise<LessonView>;
  saveProgress(id: string, p: TrainingProgressInput): Promise<{ ok: true; progressPct: number }>;
  complete(id: string): Promise<LessonDone>;
  startAttempt(lessonId: string): Promise<AttemptPaper>;
  saveAnswers(attemptId: string, answers: Record<string, string[]>): Promise<{ savedAt: string }>;
  submit(attemptId: string, answers?: Record<string, string[]>): Promise<AttemptResult>;
  result(attemptId: string): Promise<AttemptResult>;
  file(fileId: string): Promise<Blob>;
  certificatePdf(certificateId: string): Promise<Blob>;
  feedback(courseId: string, f: { kind: FeedbackKind; rating?: number; body?: string; lessonId?: string | null }): Promise<FeedbackItem>;
  tourDone(): Promise<{ ok: true }>;
}

/** The Client portal's calls under the learner's names. */
export function portalLearner(api: PortalApi): LearnerApi {
  return {
    course: (id) => api.trainingCourse(id),
    start: (id) => api.trainingStart(id),
    lesson: (id) => api.trainingLesson(id),
    saveProgress: (id, p) => api.trainingProgress(id, p),
    complete: (id) => api.trainingComplete(id),
    startAttempt: (lessonId) => api.trainingStartAttempt(lessonId),
    saveAnswers: (attemptId, answers) => api.trainingSaveAnswers(attemptId, answers),
    submit: (attemptId, answers) => api.trainingSubmit(attemptId, answers),
    result: (attemptId) => api.trainingResult(attemptId),
    file: (fileId) => api.trainingFile(fileId),
    certificatePdf: (id) => api.trainingCertificatePdf(id),
    feedback: (courseId, f) => api.trainingFeedback(courseId, f),
    tourDone: () => api.trainingTourDone(),
  };
}

export interface LearnerSide {
  api: LearnerApi;
  /** Where its pages are: '/training' (staff) or '/portal/training' (clients). */
  base: string;
  /** The Client portal (no Training Center, no certificate check link inside the app). */
  portal: boolean;
  /** Where its reads are cached (signing out drops the portal's with the rest of it). */
  keyRoot: readonly string[];
}

/** Staff: the site's own API. */
export const STAFF_SIDE: LearnerSide = { api: trainingApi(apiClient), base: '/training', portal: false, keyRoot: ['training'] };

const LearnerContext = createContext<LearnerSide>(STAFF_SIDE);

export function LearnerProvider({ side, children }: { side: LearnerSide; children: ReactNode }) {
  return <LearnerContext.Provider value={side}>{children}</LearnerContext.Provider>;
}

/** The portal's side, built once from the portal's API (the client's own, or a preview's). */
export function usePortalSide(api: PortalApi): LearnerSide {
  return useMemo(() => ({ api: portalLearner(api), base: '/portal/training', portal: true, keyRoot: ['portal', 'training'] }), [api]);
}

export const useLearner = (): LearnerSide => useContext(LearnerContext);

/**
 * A course's page and a lesson's, on this side. `module`: the feature the person came from (All courses filtered to
 * it, Learn this feature: the breadcrumbs' way back); `moduleId`: the course's module to open (1.23.30).
 */
export const coursePath = (base: string, courseId: string, module?: string | null, moduleId?: string | null) => {
  const query = [module ? `module=${encodeURIComponent(module)}` : '', moduleId ? `moduleId=${encodeURIComponent(moduleId)}` : ''].filter(Boolean).join('&');
  return `${base}/courses/${encodeURIComponent(courseId)}${query ? `?${query}` : ''}`;
};
export const lessonPath = (base: string, courseId: string, lessonId: string) =>
  `${base}/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
