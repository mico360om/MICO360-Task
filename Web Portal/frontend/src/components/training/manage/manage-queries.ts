import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { trainingApi, type CertificateStatus, type CourseStatus, type FeedbackKind, type FeedbackStatus, type ReportQuery, type TrainingModule } from '../../../api/training';

/** The Training Center's calls (one place, so a test can stand in for the server). */
export const tc = () => trainingApi(apiClient);

/** GET /training/access — who may open what (learner, manager, admin, a project manager's team reports). */
export const TRAINING_ACCESS_KEY = ['training', 'access'] as const;
/** Everything the Training Center reads (a change refreshes it all). */
export const MANAGE_KEY = ['training', 'manage'] as const;
/** The reports (Training managers, administrators and project managers). */
export const REPORTS_KEY = ['training', 'reports'] as const;

export const manageKeys = {
  courses: (f: { status?: CourseStatus | ''; module?: TrainingModule | ''; q?: string } = {}) => [...MANAGE_KEY, 'courses', f] as const,
  course: (id: string) => [...MANAGE_KEY, 'course', id] as const,
  options: [...MANAGE_KEY, 'options'] as const,
  assignments: (courseId: string) => [...MANAGE_KEY, 'assignments', courseId] as const,
  rules: [...MANAGE_KEY, 'rules'] as const,
  feedback: (f: { kind?: FeedbackKind | ''; status?: FeedbackStatus | '' }) => [...MANAGE_KEY, 'feedback', f] as const,
  certificates: (f: { courseId?: string; q?: string; status?: CertificateStatus | '' }) => [...MANAGE_KEY, 'certificates', f] as const,
  settings: ['training', 'settings'] as const,
  report: (q: ReportQuery) => [...REPORTS_KEY, q] as const,
  quizReport: (lessonId: string) => [...REPORTS_KEY, 'quiz', lessonId] as const,
};

export function useTrainingAccess() {
  return useQuery({ queryKey: TRAINING_ACCESS_KEY, queryFn: () => tc().access(), staleTime: 30_000 });
}

/** People, groups, departments, companies, projects and certificate signers (managers only). */
export function useManageOptions(enabled = true) {
  return useQuery({ queryKey: manageKeys.options, queryFn: () => tc().options(), staleTime: 60_000, enabled });
}

/** Every course, newest change first (a manager's list; filters are applied on the server). */
export function useManageCourses(f: { status?: CourseStatus | ''; module?: TrainingModule | ''; q?: string } = {}, enabled = true) {
  return useQuery({ queryKey: manageKeys.courses(f), queryFn: () => tc().courses(f), enabled });
}
