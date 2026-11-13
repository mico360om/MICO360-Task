import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api-client';
import { windowWidth } from '../../test/window-width';
import { CourseView } from './CourseView';
import { certificate, detail, fakeLearner, mine, moduleDetail, renderOnSide } from './training-fixtures';

const page = (api: ReturnType<typeof fakeLearner>, path = '/training/courses/c1', portal = false) =>
  renderOnSide(<CourseView courseId="c1" renderHeader={(t) => <h1>{t}</h1>} />, { api, path, route: portal ? '/portal/training/courses/:id' : '/training/courses/:id', portal });

let saved: { name: string; blob: Blob }[] = [];
beforeEach(() => {
  saved = [];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: new Blob() });
  });
});

describe('a course’s page', () => {
  it('shows what it is, where you are, and one Continue opens the lesson to go on with (no Starter, Beginner or rating)', async () => {
    const api = fakeLearner();
    page(api);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks basics' })).toBeInTheDocument();
    expect(screen.getByText('Create, assign and finish tasks.')).toBeInTheDocument();
    for (const gone of ['Beginner', 'Starter', '4.5 · 12 ratings', 'Rate this course']) expect(screen.queryByText(gone)).toBeNull();
    expect(screen.getByText('Mandatory')).toBeInTheDocument();
    expect(screen.getByText('Due 14 Nov')).toBeInTheDocument();
    // 13 Nov new look: a ring in lessons (a plain course) in place of the 40% bar.
    expect(screen.getByRole('img', { name: '1 of 4 lessons done' })).toHaveTextContent('1 / 4');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getAllByRole('button').filter((b) => /^(Start|Continue|Review)$/.test(b.textContent ?? ''))).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l2');
    expect(api.start).not.toHaveBeenCalled();
  });

  it('the outline: kind, minutes, done ticks, locked lessons (not links) and “Review” marks', async () => {
    page(fakeLearner({ course: vi.fn(async () => detail({ lessons: [...detail().lessons.slice(0, 3), { ...detail().lessons[3]!, review: true, locked: false }] })) }));
    const lessons = (await screen.findByRole('heading', { name: 'Lessons' })).parentElement!;
    expect(within(lessons).getByRole('link', { name: /Welcome/ })).toHaveAttribute('href', '/training/courses/c1/lessons/l1');
    expect(within(within(lessons).getByRole('link', { name: /Welcome/ })).getByText('Done')).toBeInTheDocument();
    expect(within(lessons).getByText('8 min', { exact: false })).toBeInTheDocument();
    // Locked: no link, said so.
    expect(within(lessons).queryByRole('link', { name: /The cheat sheet/ })).toBeNull();
    expect(within(lessons).getByText('Locked')).toBeInTheDocument();
    expect(within(lessons).getByText('Finish the lessons before it first.')).toBeInTheDocument();
    expect(within(within(lessons).getByRole('link', { name: /Check yourself/ })).getByText('Review')).toBeInTheDocument();
  });

  it('not started: no status chip and no 0% bar; Start starts it, then opens its first lesson to take', async () => {
    const api = fakeLearner({ course: vi.fn(async () => detail({ mine: mine({ enrolled: false, status: 'NOT_STARTED', progressPct: 0, assigned: false, mandatory: false, dueDay: null }), resumeLessonId: 'l1' })) });
    api.start.mockResolvedValue(detail({ resumeLessonId: 'l1' }));
    page(api);
    const start = await screen.findByRole('button', { name: 'Start' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('Not started')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    await userEvent.click(start);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l1'));
    expect(api.start).toHaveBeenCalledWith('c1');
  });

  it('a manager previewing a course that isn’t theirs to take hears why, plainly', async () => {
    const api = fakeLearner({ course: vi.fn(async () => detail({ mine: mine({ enrolled: false, status: 'NOT_STARTED', progressPct: 0 }) })) });
    api.start.mockRejectedValue(new ApiError(409, 'NOT_FOR_YOU', 'You can preview this course, but it isn’t one of yours to take.'));
    page(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You can preview this course, but it isn’t one of yours to take.');
  });

  it('completed: the certificate right under the title (code, PDF, online check), then Review (from the first lesson)', async () => {
    const cert = { id: 'cert1', code: 'TC-ABCD-EFGH-JKLM', courseId: 'c1', courseTitle: 'Tasks basics', issuedAt: '2026-11-05T08:00:00.000Z', expiresAt: '2027-11-05T08:00:00.000Z', status: 'VALID' as const, completedAt: '2026-11-05T08:00:00.000Z', learnerName: 'Sam Shared', verifyUrl: 'https://tasks.example.com/verify/TC-ABCD-EFGH-JKLM' };
    const api = fakeLearner({ course: vi.fn(async () => detail({ mine: mine({ status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-05T08:00:00.000Z', certificate: cert }) })) });
    page(api);
    const box = (await screen.findByRole('heading', { name: 'Certificate' })).closest('section')!;
    // Under the title, before everything else (on a phone too: one column).
    expect(box.compareDocumentPosition(screen.getByRole('heading', { name: 'Lessons' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(screen.getByText('Create, assign and finish tasks.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(box).getByText('TC-ABCD-EFGH-JKLM')).toBeInTheDocument();
    expect(within(box).getByText('Valid')).toBeInTheDocument();
    expect(within(box).getByText('5 Nov 2027')).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'Check it online' })).toHaveAttribute('href', '/verify/TC-ABCD-EFGH-JKLM');
    await userEvent.click(within(box).getByRole('button', { name: /Download certificate/ }));
    await waitFor(() => expect(saved.map((s) => s.name)).toEqual(['certificate-TC-ABCD-EFGH-JKLM.pdf']));
    expect(api.certificatePdf).toHaveBeenCalledWith('cert1');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/c1/lessons/l1');
  });

  it('review after a major change, and a retake after expiry, say so (the button in the new look’s three words)', async () => {
    const review = page(fakeLearner({ course: vi.fn(async () => detail({ mine: mine({ status: 'REVIEW', progressPct: 80 }) })) }));
    expect(await screen.findByRole('button', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByText(/your certificate stays valid meanwhile/)).toBeInTheDocument();
    review.unmount();
    page(fakeLearner({ course: vi.fn(async () => detail({ mine: mine({ status: 'RETAKE', progressPct: 0, lessonsDone: 0 }) })) }));
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByText(/Your certificate has expired/)).toBeInTheDocument();
  });

  it('downloads a resource under its own name', async () => {
    const api = fakeLearner();
    page(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Download Tasks guide.pdf' }));
    await waitFor(() => expect(saved.map((s) => s.name)).toEqual(['Tasks guide.pdf']));
    expect(api.file).toHaveBeenCalledWith('f1');
  });

  it('rating: only after finishing — five stars (radios), saved as a rating', async () => {
    const a = page(fakeLearner());
    await screen.findByRole('heading', { level: 1, name: 'Tasks basics' });
    expect(screen.queryByRole('heading', { name: 'Rate this course' })).toBeNull();
    a.unmount();
    const api = fakeLearner({ course: vi.fn(async () => detail({ mine: mine({ status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-05T08:00:00.000Z' }) })) });
    page(api);
    const group = (await screen.findByRole('heading', { name: 'Rate this course' })).closest('section')!;
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    await userEvent.click(within(group).getByRole('radio', { name: '4 stars' }));
    await waitFor(() => expect(api.feedback).toHaveBeenCalledWith('c1', { kind: 'RATING', rating: 4 }));
    expect(await within(group).findByText('Thanks — you gave it 4 stars.')).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: '4 stars' })).toBeChecked();
  });

  it('questions: answered ones and your own waiting one; “Ask a question” opens a small box that sends it', async () => {
    const api = fakeLearner();
    page(api);
    expect(await screen.findByText('Can I assign a task to two people?')).toBeInTheDocument();
    expect(screen.getByText('Yes — add both as assignees.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for an answer')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your question' })).toBeNull();
    const ask = screen.getByRole('button', { name: 'Ask a question' });
    await userEvent.click(ask);
    expect(ask).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
    expect(screen.getByText('Write your question first.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'How do I copy a task?');
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(api.feedback).toHaveBeenCalledWith('c1', { kind: 'QUESTION', body: 'How do I copy a task?' }));
    expect(await screen.findByText(/The training team will answer here/)).toBeInTheDocument();
  });

  it('breadcrumbs: Learning Hub › (the module’s courses, from ?module=) › the course', async () => {
    const one = page(fakeLearner(), '/training/courses/c1?module=tasks');
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    await screen.findByRole('heading', { level: 1, name: 'Tasks basics' });
    expect(crumbs().getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '/training');
    expect(crumbs().getByRole('link', { name: 'Tasks courses' })).toHaveAttribute('href', '/training?tab=catalogue&module=tasks');
    expect(crumbs().getByText('Tasks basics').closest('[aria-current="page"]')).not.toBeNull();
    one.unmount();
    page(fakeLearner());
    await screen.findByRole('heading', { level: 1, name: 'Tasks basics' });
    expect(crumbs().getAllByRole('link').map((l) => l.textContent)).toEqual(['Learning Hub']);
  });

  it('a course that isn’t available says so in plain words', async () => {
    page(fakeLearner({ course: vi.fn(async () => Promise.reject(new ApiError(404, 'NOT_FOUND', 'Course not found.'))) }));
    expect(await screen.findByText('This course isn’t available to you.')).toBeInTheDocument();
  });

  it('the certificate is the certificate view: the learner, the day finished and a QR code (staff and the portal)', async () => {
    const cert = certificate({ courseId: 'c1', courseTitle: 'Tasks basics' });
    const done = () => detail({ mine: mine({ status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-03T08:00:00.000Z', certificate: cert }) });
    const one = page(fakeLearner({ course: vi.fn(async () => done()) }));
    const box = (await screen.findByRole('heading', { name: 'Certificate' })).closest('section')!;
    expect(within(box).getByText('Mariam Al Balushi')).toBeInTheDocument();
    expect(within(box).getByText('Completed 3 Nov 2026')).toBeInTheDocument();
    expect(within(box).getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    one.unmount();
    page(fakeLearner({ course: vi.fn(async () => done()) }), '/portal/training/courses/c1', true);
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Check it online' })).toBeNull();
  });

  it('an old short course’s link: the one course opens at its module (the old address replaced)', async () => {
    const api = fakeLearner({ course: vi.fn(async () => Promise.reject(new ApiError(404, 'COURSE_MOVED', 'This course is now part of MICO360 Tasks User Training.', { courseId: 'u1', moduleId: 'tk' }))) });
    page(api, '/training/courses/c1?module=tasks');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1?moduleId=tk'));
    expect(screen.queryByText('This course isn’t available to you.')).toBeNull();
  });

  it('an old link whose module is gone: the one course’s page', async () => {
    page(fakeLearner({ course: vi.fn(async () => Promise.reject(new ApiError(404, 'COURSE_MOVED', 'Moved.', { courseId: 'u1', moduleId: null }))) }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/training\/courses\/u1$/));
  });

  it('in the Client portal: the same page through the portal’s side (its own addresses)', async () => {
    const api = fakeLearner();
    page(api, '/portal/training/courses/c1', true);
    expect(await within(await screen.findByRole('navigation', { name: 'Breadcrumb' })).findByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '/portal/training');
    expect(await screen.findByRole('link', { name: /Welcome/ })).toHaveAttribute('href', '/portal/training/courses/c1/lessons/l1');
  });
});

describe('the one course with modules (1.23.30)', () => {
  const modulePage = (api: ReturnType<typeof fakeLearner>, path = '/training/courses/u1') =>
    renderOnSide(<CourseView courseId="u1" renderHeader={(t) => <h1>{t}</h1>} />, { api, path, route: '/training/courses/:id' });

  it('how far along in modules, one Continue that opens where they stopped, and the modules in place of the lesson list', async () => {
    const api = fakeLearner({ course: vi.fn(async () => moduleDetail()) });
    modulePage(api);
    expect(await screen.findByRole('heading', { level: 1, name: 'MICO360 Tasks User Training' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '1 of 3 modules done' })).toHaveTextContent('1 / 3');
    expect(screen.getByText('· 3 modules')).toBeInTheDocument();
    expect(screen.queryByText('· 7 lessons')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Lessons' })).toBeNull();
    const modules = screen.getByRole('region', { name: 'Modules' });
    expect(within(modules).getByRole('button', { name: /^Getting started/ })).toHaveTextContent('Done · 3 Nov 2026');
    expect(within(modules).getByRole('button', { name: /^Tasks/ })).toHaveTextContent('In progress · 1 of 3 lessons');
    expect(within(modules).getByRole('button', { name: /^Kanban board/ })).toHaveTextContent('Not started');
    expect(screen.getAllByRole('button').filter((b) => /^(Start|Continue|Review)$/.test(b.textContent ?? ''))).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/t2');
  });

  it('?moduleId= opens that module (and the page doesn’t jump back to the top)', async () => {
    const top = vi.fn();
    const into = vi.fn();
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = into;
    Object.defineProperty(document, 'scrollingElement', { configurable: true, get: () => ({ scrollTo: top }) });
    try {
      modulePage(fakeLearner({ course: vi.fn(async () => moduleDetail()) }), '/training/courses/u1?moduleId=kb');
      const kb = await screen.findByRole('button', { name: /^Kanban board/ });
      expect(kb).toHaveAttribute('aria-expanded', 'true');
      expect(within(document.getElementById(kb.getAttribute('aria-controls')!)!).getByRole('link', { name: /Video: the Kanban board/ })).toHaveAttribute('href', '/training/courses/u1/lessons/k1');
      expect(into).toHaveBeenCalled();
      expect(top).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = before;
      delete (document as { scrollingElement?: unknown }).scrollingElement;
    }
  });

  it('finished, then new modules for a grown role: still Done, the new module marked, and Continue opens it', async () => {
    const c = moduleDetail();
    const api = fakeLearner({
      course: vi.fn(async () =>
        moduleDetail({
          mine: mine({ ...c.mine, status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-05T08:00:00.000Z', newForRole: 1, modules: { done: 2, total: 3 } }),
          modules: c.modules.map((m) => (m.id === 'tk' ? { ...m, status: 'DONE' as const, lessonsDone: 3, doneAt: '2026-11-05T08:00:00.000Z', nextLessonId: null } : m.id === 'kb' ? { ...m, newForRole: true } : m)),
          resumeLessonId: 'k1',
        }),
      ),
    });
    modulePage(api);
    expect(await screen.findByText('Done · 5 Nov 2026', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Kanban board/ })).toHaveTextContent('New for your role');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/training/courses/u1/lessons/k1');
  });
});

describe('the course page’s new look (13 Nov)', () => {
  const modulePage = (api: ReturnType<typeof fakeLearner>, path = '/training/courses/u1', portal = false) =>
    renderOnSide(<CourseView courseId="u1" renderHeader={(t) => <h1>{t}</h1>} />, { api, path, route: portal ? '/portal/training/courses/:id' : '/training/courses/:id', portal });
  const asked = { id: 'q1', question: 'Can I assign a task to two people?', answer: 'Yes — add both as assignees.', askedAt: '2026-11-02T08:00:00.000Z', answeredAt: '2026-11-03T08:00:00.000Z', mine: false };
  const due = () => moduleDetail({ mine: mine({ ...moduleDetail().mine, dueDay: '2026-11-14', mandatory: true }), questions: [asked] });
  const side = () => document.querySelector<HTMLElement>('[data-course-side]')!;
  const main = () => document.querySelector<HTMLElement>('[data-course-main]')!;
  const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('from 1024 px two columns: the modules (with their icons) on the left; on the right a sticky panel — the ring, Due, one main button, the certificate card, Questions', async () => {
    windowWidth(1280);
    try {
      modulePage(fakeLearner({ course: vi.fn(async () => due()) }));
      await screen.findByRole('heading', { level: 1, name: 'MICO360 Tasks User Training' });
      expect(within(main()).getByRole('region', { name: 'Modules' })).toBeInTheDocument();
      expect(within(main()).getByRole('button', { name: /^Tasks/ }).querySelector('[data-module-icon="tasks"]')).not.toBeNull();
      const panel = within(side());
      expect(side().className).toContain('lg:sticky');
      expect(panel.getByRole('img', { name: '1 of 3 modules done' })).toHaveTextContent('1 / 3');
      expect(panel.getByText('modules done')).toBeInTheDocument();
      expect(panel.getByText('About 20 min left')).toBeInTheDocument();
      expect(panel.getByText('Due 14 Nov')).toBeInTheDocument();
      expect(panel.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(panel.getByRole('region', { name: 'Certificate' })).toHaveTextContent('Finish 2 more modules to get it');
      expect(panel.getByRole('heading', { name: 'Questions' })).toBeInTheDocument();
      expect(panel.getByText('Can I assign a task to two people?')).toBeInTheDocument();
      // In that order; nothing of it on the left.
      expect(before(panel.getByRole('button', { name: 'Continue' }), panel.getByRole('region', { name: 'Certificate' }))).toBe(true);
      expect(before(panel.getByRole('region', { name: 'Certificate' }), panel.getByRole('heading', { name: 'Questions' }))).toBe(true);
      expect(within(main()).queryByRole('heading', { name: 'Questions' })).toBeNull();
      expect(within(main()).queryByRole('button', { name: 'Continue' })).toBeNull();
      // Still one main button on the page.
      expect(screen.getAllByRole('button').filter((b) => /^(Start|Continue|Review)$/.test(b.textContent ?? ''))).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('on a phone: a compact progress row and the button above the module list; the certificate card after it; Questions last', async () => {
    windowWidth(375);
    try {
      modulePage(fakeLearner({ course: vi.fn(async () => due()) }));
      const modules = await screen.findByRole('region', { name: 'Modules' });
      const ring = screen.getByRole('img', { name: '1 of 3 modules done' });
      const go = screen.getByRole('button', { name: 'Continue' });
      const about = screen.getByRole('region', { name: 'About this course' });
      const cert = screen.getByRole('region', { name: 'Certificate' });
      const questions = screen.getByRole('heading', { name: 'Questions' });
      // The page reads (and tabs) in the order it shows: about → progress and the button → modules → certificate → questions.
      expect(before(about, ring)).toBe(true);
      expect(before(ring, go)).toBe(true);
      expect(before(go, modules)).toBe(true);
      expect(before(modules, cert)).toBe(true);
      expect(before(cert, questions)).toBe(true);
      // The progress row sits in the page's one column (the side holds only Questions).
      expect(main().contains(go)).toBe(true);
      expect(within(side()).queryByRole('img')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the course’s header line: how long, the module count, Mandatory and “Certificate when you finish”, on one line', async () => {
    modulePage(fakeLearner({ course: vi.fn(async () => due()) }));
    await screen.findByRole('heading', { level: 1, name: 'MICO360 Tasks User Training' });
    const line = document.querySelector<HTMLElement>('[data-course-facts]')!;
    expect(line).toHaveTextContent('1 h 30 min');
    expect(line).toHaveTextContent('· 3 modules');
    expect(line).toHaveTextContent('Mandatory');
    expect(line).toHaveTextContent('Certificate when you finish');
  });

  it('overdue: “Overdue · was due 9 Nov” beside the ring', async () => {
    modulePage(fakeLearner({ course: vi.fn(async () => moduleDetail({ mine: mine({ ...moduleDetail().mine, dueDay: '2026-11-09', overdue: true }) })) }));
    expect(await screen.findByText('Overdue · was due 9 Nov')).toBeInTheDocument();
  });

  it('a manager previewing (not theirs to take): the ring at 0, Start, and the reason said under it', async () => {
    const api = fakeLearner({ course: vi.fn(async () => moduleDetail({ mine: mine({ ...moduleDetail().mine, enrolled: false, status: 'NOT_STARTED', progressPct: 0, lessonsDone: 0, modules: { done: 0, total: 3 } }) })) });
    api.start.mockRejectedValue(new ApiError(409, 'NOT_FOR_YOU', 'You can preview this course, but it isn’t one of yours to take.'));
    modulePage(api);
    expect(await screen.findByRole('img', { name: '0 of 3 modules done' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t one of yours to take');
  });

  it('finished: the full ring and the day, Review; the certificate is the one at the top (no second certificate card)', async () => {
    windowWidth(1280);
    try {
      const c = moduleDetail();
      modulePage(
        fakeLearner({
          course: vi.fn(async () =>
            moduleDetail({
              mine: mine({ ...c.mine, status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-05T08:00:00.000Z', modules: { done: 3, total: 3 }, certificate: certificate() }),
              lessons: c.lessons.map((l) => ({ ...l, done: true })),
              modules: c.modules.map((m) => ({ ...m, status: 'DONE' as const, lessonsDone: m.lessonCount, doneAt: '2026-11-05T08:00:00.000Z', nextLessonId: null })),
              resumeLessonId: 'g1',
            }),
          ),
        }),
      );
      const ring = await screen.findByRole('img', { name: '3 of 3 modules done' });
      expect(ring).toHaveAttribute('data-complete', 'true');
      const panel = within(side());
      expect(panel.getByText('Done · 5 Nov 2026', { selector: 'p' })).toBeInTheDocument();
      expect(panel.queryByText(/min left/)).toBeNull();
      expect(panel.getByRole('button', { name: 'Review' })).toBeInTheDocument();
      expect(screen.getAllByRole('region', { name: 'Certificate' })).toHaveLength(1);
      expect(main().querySelector('[data-certificate]')).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('finished, then modules new for a grown role: “Finish the new modules for an updated certificate” beside the ring', async () => {
    const c = moduleDetail();
    modulePage(
      fakeLearner({
        course: vi.fn(async () =>
          moduleDetail({
            mine: mine({ ...c.mine, status: 'COMPLETED', progressPct: 100, completedAt: '2026-11-05T08:00:00.000Z', newForRole: 1, modules: { done: 2, total: 3 }, certificate: certificate() }),
            modules: c.modules.map((m) => (m.id === 'tk' ? { ...m, status: 'DONE' as const, lessonsDone: 3, doneAt: '2026-11-05T08:00:00.000Z', nextLessonId: null } : m.id === 'kb' ? { ...m, newForRole: true } : m)),
            resumeLessonId: 'k1',
          }),
        ),
      }),
    );
    expect(await screen.findByText('Finish the new modules for an updated certificate')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 of 3 modules done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('in the Client portal: the same panel, the portal’s addresses, no “Check it online”', async () => {
    windowWidth(1280);
    try {
      modulePage(fakeLearner({ course: vi.fn(async () => due()) }), '/portal/training/courses/u1', true);
      await screen.findByRole('img', { name: '1 of 3 modules done' });
      expect(within(side()).getByRole('region', { name: 'Certificate' })).toBeInTheDocument();
      await userEvent.click(within(side()).getByRole('button', { name: 'Continue' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/portal/training/courses/u1/lessons/t2');
      expect(screen.queryByText('Check it online')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
