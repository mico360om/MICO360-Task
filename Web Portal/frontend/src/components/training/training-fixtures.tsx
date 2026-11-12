import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { AttemptPaper, AttemptResult, CourseCard, CourseDetail, LessonView, MyCourseState, MyTraining } from '../../api/training';
import { LearnerProvider, type LearnerApi, type LearnerSide } from './learner';

/** Test data for the training pages (staff and portal), in the server's shapes. */

export const mine = (over: Partial<MyCourseState> = {}): MyCourseState => ({
  enrolled: true,
  status: 'IN_PROGRESS',
  progressPct: 40,
  assigned: true,
  mandatory: true,
  dueDay: '2026-11-14',
  overdue: false,
  lastLessonId: 'l2',
  nextLessonId: 'l2',
  startedAt: '2026-11-01T08:00:00.000Z',
  completedAt: null,
  certificate: null,
  ...over,
});

export const card = (over: Partial<CourseCard> = {}): CourseCard => ({
  id: 'c1',
  title: 'Tasks basics',
  summary: 'Create, assign and finish tasks.',
  moduleKey: 'tasks',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  minutes: 25,
  lessonCount: 4,
  certificateOn: true,
  starter: true,
  rating: { average: 4.5, count: 12 },
  mine: mine(),
  ...over,
});

export const detail = (over: Partial<CourseDetail> = {}): CourseDetail => ({
  ...card(),
  completionRule: 'ALL_LESSONS',
  inOrder: true,
  version: 1,
  certificateMonths: 12,
  lessons: [
    { id: 'l1', position: 0, kind: 'VIDEO', title: 'Welcome', minutes: 3, done: true, locked: false, review: false },
    { id: 'l2', position: 1, kind: 'GUIDE', title: 'Make a task', minutes: 8, done: false, locked: false, review: false },
    { id: 'l3', position: 2, kind: 'DOCUMENT', title: 'The cheat sheet', minutes: 4, done: false, locked: true, review: false },
    { id: 'l4', position: 3, kind: 'QUIZ', title: 'Check yourself', minutes: 10, done: false, locked: true, review: false },
  ],
  resources: [{ id: 'f1', name: 'Tasks guide.pdf', mimeType: 'application/pdf', sizeBytes: 3_600_000, kind: 'RESOURCE' }],
  questions: [
    { id: 'q1', question: 'Can I assign a task to two people?', answer: 'Yes — add both as assignees.', askedAt: '2026-11-02T08:00:00.000Z', answeredAt: '2026-11-03T08:00:00.000Z', mine: false },
    { id: 'q2', question: 'Where are archived tasks?', answer: null, askedAt: '2026-11-09T08:00:00.000Z', answeredAt: null, mine: true },
  ],
  myRating: null,
  resumeLessonId: 'l2',
  ...over,
});

export const lesson = (over: Partial<LessonView> = {}): LessonView => ({
  id: 'l2',
  courseId: 'c1',
  courseTitle: 'Tasks basics',
  kind: 'GUIDE',
  title: 'Make a task',
  minutes: 8,
  position: 1,
  lessonCount: 4,
  body: null,
  prevLessonId: 'l1',
  nextLessonId: 'l3',
  video: null,
  steps: [],
  document: null,
  quiz: null,
  progress: { done: false, videoSeconds: 0, watchedPct: 0, stepIndex: 0 },
  courseProgressPct: 25,
  watchFallbackSeconds: 30,
  ...over,
});

export const myTraining = (over: Partial<MyTraining> = {}): MyTraining => ({
  counts: { assigned: 2, inProgress: 1, notStarted: 1, completed: 1, overdue: 1, review: 0 },
  assigned: [
    card({ id: 'c1', title: 'Tasks basics', mine: mine({ overdue: true, dueDay: '2026-11-04' }) }),
    card({ id: 'c2', title: 'Meetings & minutes', moduleKey: 'meetings', mine: mine({ mandatory: false, status: 'NOT_STARTED', progressPct: 0, dueDay: '2026-11-20' }) }),
  ],
  inProgress: [card({ id: 'c3', title: 'Calendar tips', moduleKey: 'calendar', mine: mine({ assigned: false, mandatory: false, dueDay: null, progressPct: 60 }) })],
  completed: [card({ id: 'c4', title: 'Kanban board', moduleKey: 'board', mine: mine({ status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-05T08:00:00.000Z' }) })],
  certificates: [{ id: 'cert1', code: 'TC-ABCD-EFGH-JKLM', courseId: 'c4', courseTitle: 'Kanban board', issuedAt: '2026-11-05T08:00:00.000Z', expiresAt: '2027-11-05T08:00:00.000Z', status: 'VALID' }],
  ...over,
});

export const paper = (over: Partial<AttemptPaper> = {}): AttemptPaper => ({
  id: 'a1',
  lessonId: 'l4',
  courseId: 'c1',
  startedAt: '2026-11-11T08:00:00.000Z',
  deadlineAt: null,
  questions: [
    { id: 'qs', kind: 'SINGLE', prompt: 'Where is New task?', options: [{ id: 'o1', text: 'Top bar' }, { id: 'o2', text: 'Footer' }] },
    { id: 'qm', kind: 'MULTIPLE', prompt: 'Which can a task have?', options: [{ id: 'o3', text: 'Assignees' }, { id: 'o4', text: 'Due day' }, { id: 'o5', text: 'A song' }] },
    { id: 'qt', kind: 'TRUE_FALSE', prompt: 'A task can be in two projects.', options: [{ id: 'o6', text: 'True' }, { id: 'o7', text: 'False' }] },
    { id: 'qo', kind: 'ORDER', prompt: 'Put the steps in order.', options: [{ id: 'p3', text: 'Save' }, { id: 'p1', text: 'Open the form' }, { id: 'p2', text: 'Type a title' }] },
  ],
  answers: {},
  ...over,
});

export const result = (over: Partial<AttemptResult> = {}): AttemptResult => ({
  id: 'a1',
  lessonId: 'l4',
  courseId: 'c1',
  submittedAt: '2026-11-11T08:10:00.000Z',
  scorePct: 50,
  passed: false,
  passMark: 75,
  attemptsLeft: 2,
  timedOut: false,
  answersShown: false,
  questions: [
    {
      id: 'qs',
      kind: 'SINGLE',
      prompt: 'Where is New task?',
      right: true,
      chosen: ['o1'],
      options: [
        { id: 'o1', text: 'Top bar', correct: true, position: 0, feedback: 'Yes — on every page.' },
        { id: 'o2', text: 'Footer', correct: false, position: 1, feedback: 'The footer only has the version.' },
      ],
      explanation: null,
    },
    {
      id: 'qo',
      kind: 'ORDER',
      prompt: 'Put the steps in order.',
      right: false,
      chosen: ['p2', 'p1', 'p3'],
      options: [
        { id: 'p3', text: 'Save', correct: true, position: 2, feedback: null },
        { id: 'p1', text: 'Open the form', correct: true, position: 0, feedback: null },
        { id: 'p2', text: 'Type a title', correct: true, position: 1, feedback: null },
      ],
      explanation: 'Open it first, then type, then save.',
    },
  ],
  courseCompleted: false,
  certificateId: null,
  ...over,
});

/** A learner API whose every call is a mock (each test says what the server answers). */
export function fakeLearner(over: Partial<LearnerApi> = {}): { [K in keyof LearnerApi]: ReturnType<typeof vi.fn> } & LearnerApi {
  const api = {
    course: vi.fn(async () => detail()),
    start: vi.fn(async () => detail({ mine: mine({ enrolled: true }) })),
    lesson: vi.fn(async () => lesson()),
    saveProgress: vi.fn(async () => ({ ok: true as const, progressPct: 40 })),
    complete: vi.fn(async () => ({ courseProgressPct: 50, courseCompleted: false, certificateId: null, nextLessonId: 'l3' })),
    startAttempt: vi.fn(async () => paper()),
    saveAnswers: vi.fn(async () => ({ savedAt: '2026-11-11T08:01:00.000Z' })),
    submit: vi.fn(async () => result()),
    result: vi.fn(async () => result()),
    file: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
    certificatePdf: vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' })),
    feedback: vi.fn(async () => ({ id: 'fb1' }) as never),
    tourDone: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
  return api as never;
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

/** Render on a side (staff by default) at an address, with the given routes. */
export function renderOnSide(ui: ReactElement, { api, path = '/', route = '*', portal = false }: { api: LearnerApi; path?: string; route?: string; portal?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const side: LearnerSide = portal ? { api, base: '/portal/training', portal: true, keyRoot: ['portal', 'training'] } : { api, base: '/training', portal: false, keyRoot: ['training'] };
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <LearnerProvider side={side}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={route} element={ui} />
              <Route path="*" element={<div>elsewhere</div>} />
            </Routes>
            <Where />
          </MemoryRouter>
        </LearnerProvider>
      </QueryClientProvider>,
    ),
  };
}
