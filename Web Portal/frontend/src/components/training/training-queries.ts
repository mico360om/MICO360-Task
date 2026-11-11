import { useQuery, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { trainingApi, type CatalogueFilters, type CourseDetail, type TrainingModule } from '../../api/training';
import { useLearner, type LearnerSide } from './learner';

/** The staff side's reads (My training, the catalogue, the badge, Learn this feature). */
const staff = trainingApi(apiClient);

export const trainingKeys = {
  all: ['training'] as const,
  access: ['training', 'access'] as const,
  me: ['training', 'me'] as const,
  catalogue: (f: CatalogueFilters) => ['training', 'catalogue', f.module ?? '', f.difficulty ?? '', f.q ?? ''] as const,
  learn: (module: TrainingModule) => ['training', 'learn', module] as const,
};

/** A course and a lesson on either side (staff or the portal). */
export const sideKeys = {
  course: (side: LearnerSide, id: string) => [...side.keyRoot, 'course', id] as const,
  lesson: (side: LearnerSide, id: string) => [...side.keyRoot, 'lesson', id] as const,
  result: (side: LearnerSide, id: string) => [...side.keyRoot, 'result', id] as const,
};

/**
 * What the Training Center lets this person do, their overdue count (the menu's and the dashboard's red badge)
 * and whether the first-time tour shows by itself. Light on the server; read again every few minutes.
 */
export function useTrainingAccess(enabled = true) {
  return useQuery({ queryKey: trainingKeys.access, queryFn: () => staff.access(), staleTime: 60_000, refetchInterval: 5 * 60_000, enabled, retry: false });
}

/** My training (runs the person's sync on the server first). */
export function useMyTraining() {
  return useQuery({ queryKey: trainingKeys.me, queryFn: () => staff.me() });
}

export function useCatalogue(f: CatalogueFilters, enabled = true) {
  return useQuery({ queryKey: trainingKeys.catalogue(f), queryFn: () => staff.catalogue(f), enabled, placeholderData: (prev) => prev });
}

/** Learn this feature: is there a course for this module (one cached read per module, 5 minutes). */
export function useLearn(module: TrainingModule) {
  return useQuery({ queryKey: trainingKeys.learn(module), queryFn: () => staff.learn(module), staleTime: 5 * 60_000, retry: false });
}

export function useCourse(id: string) {
  const side = useLearner();
  return useQuery({ queryKey: sideKeys.course(side, id), queryFn: () => side.api.course(id), enabled: Boolean(id) });
}

export function useLessonView(id: string) {
  const side = useLearner();
  // A lesson's saved place changes as it is taken: always read afresh when it opens.
  return useQuery({ queryKey: sideKeys.lesson(side, id), queryFn: () => side.api.lesson(id), enabled: Boolean(id), staleTime: 0, refetchOnWindowFocus: false });
}

/** Something about a course changed (a lesson done, a quiz handed in, a rating): every list and page reads again. */
export function courseChanged(qc: QueryClient, side: LearnerSide, courseId: string, detail?: CourseDetail): void {
  if (detail) qc.setQueryData(sideKeys.course(side, courseId), detail);
  void qc.invalidateQueries({ queryKey: sideKeys.course(side, courseId), exact: true });
  if (side.portal) {
    void qc.invalidateQueries({ queryKey: [...side.keyRoot, 'home'] });
    void qc.invalidateQueries({ queryKey: [...side.keyRoot, 'summary'] });
  } else {
    void qc.invalidateQueries({ queryKey: trainingKeys.me });
    void qc.invalidateQueries({ queryKey: trainingKeys.access });
    void qc.invalidateQueries({ queryKey: ['training', 'catalogue'] });
    void qc.invalidateQueries({ queryKey: ['training', 'learn'] });
  }
}
