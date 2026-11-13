import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseEditorPage } from '../../../pages/training/CourseEditorPage';
import { fakeTrainingApi, fileRef, lesson, manageCourse, quiz, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { ApiError } from '../../../lib/api-client';
import type { ManageLesson } from '../../../api/training';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));

const PATH = { path: '/training/manage/courses/c1', route: '/training/manage/courses/:id' };
const withLessons = (...lessons: ManageLesson[]) => manageCourse({ lessons: lessons.map((l, i) => ({ ...l, position: i })) });
const open = async (...lessons: ManageLesson[]) => {
  api.manageCourse.mockResolvedValue(withLessons(...lessons));
  renderManage(<CourseEditorPage />, PATH);
  return screen.findByRole('region', { name: 'Lessons' });
};
const expand = async (title: string) => {
  const toggle = await screen.findByRole('button', { name: title });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return screen.getByRole('form', { name: `Lesson “${title}”` }).parentElement!;
};

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
});

describe('Course editor: lessons', () => {
  it('adds a lesson of each kind: a video, a step-by-step guide, a document and a quiz', async () => {
    const lessons = await open();
    expect(within(lessons).getByText(/No lessons yet/)).toBeInTheDocument();
    const kinds = [
      ['Video', 'VIDEO', 'Watch how'],
      ['Step-by-step guide', 'GUIDE', 'Make a task'],
      ['Document', 'DOCUMENT', 'The handbook'],
      ['Quiz', 'QUIZ', 'Check yourself'],
    ] as const;
    for (const [label, kind, title] of kinds) {
      api.addLesson.mockResolvedValueOnce(lesson({ id: `l-${kind}`, kind, title }));
      await userEvent.click(within(lessons).getByRole('button', { name: 'Add lesson' }));
      const dialog = screen.getByRole('dialog', { name: 'Add lesson' });
      await userEvent.click(within(dialog).getByRole('radio', { name: new RegExp(`^${label}`) }));
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), title);
      const minutes = within(dialog).getByRole('spinbutton', { name: 'Minutes' });
      await userEvent.clear(minutes);
      await userEvent.type(minutes, '8');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add lesson' }));
      await waitFor(() => expect(api.addLesson).toHaveBeenLastCalledWith('c1', { kind, title, minutes: 8 }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(api.addLesson).toHaveBeenCalledTimes(4);
  });

  it('a lesson needs a title', async () => {
    const lessons = await open();
    await userEvent.click(within(lessons).getByRole('button', { name: 'Add lesson' }));
    const dialog = screen.getByRole('dialog', { name: 'Add lesson' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lesson' }));
    expect(within(dialog).getByText('Give the lesson a title.')).toBeInTheDocument();
    expect(api.addLesson).not.toHaveBeenCalled();
  });

  it('moves a lesson up or down (the whole order is sent) and keeps the focus on the moved lesson', async () => {
    const a = lesson({ id: 'a', kind: 'GUIDE', title: 'First' });
    const b = lesson({ id: 'b', kind: 'VIDEO', title: 'Second' });
    const c = lesson({ id: 'c', kind: 'QUIZ', title: 'Third' });
    const lessons = await open(a, b, c);
    expect(within(lessons).getAllByRole('listitem').map((li) => within(li).getAllByRole('button')[0]!.textContent)).toEqual(['First', 'Second', 'Third']);
    expect(within(lessons).getByRole('button', { name: 'Move “First” up' })).toBeDisabled();
    expect(within(lessons).getByRole('button', { name: 'Move “Third” down' })).toBeDisabled();
    const reordered = withLessons(b, a, c);
    api.reorderLessons.mockResolvedValue(reordered);
    api.manageCourse.mockResolvedValue(reordered);
    await userEvent.click(within(lessons).getByRole('button', { name: 'Move “Second” up' }));
    await waitFor(() => expect(api.reorderLessons).toHaveBeenCalledWith('c1', ['b', 'a', 'c']));
    await waitFor(() => expect(within(lessons).getAllByRole('listitem').map((li) => within(li).getAllByRole('button')[0]!.textContent)).toEqual(['Second', 'First', 'Third']));
    // It reached the top: its other button has the focus.
    await waitFor(() => expect(within(lessons).getByRole('button', { name: 'Move “Second” down' })).toHaveFocus());
  });

  it('deletes a lesson after asking', async () => {
    const lessons = await open(lesson({ id: 'a', kind: 'GUIDE', title: 'First' }));
    await userEvent.click(within(lessons).getByRole('button', { name: 'Delete “First”' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete the lesson “First”?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete lesson' }));
    await waitFor(() => expect(api.deleteLesson).toHaveBeenCalledWith('a'));
  });

  // Owner, 13 Nov (batch 4b): the quiz of a published course that gives a certificate — the server says how many
  // people deleting it finishes (and certifies), and the administrator is asked first: Delete / Cancel.
  describe('deleting the quiz of a published certificate course', () => {
    const certCourse = (...lessons: ManageLesson[]) => manageCourse({ status: 'PUBLISHED', certificateOn: true, lessons: lessons.map((l, i) => ({ ...l, position: i })) });
    const openCert = async () => {
      api.manageCourse.mockResolvedValue(certCourse(lesson({ id: 'g', kind: 'GUIDE', title: 'Read' }), lesson({ id: 'q', kind: 'QUIZ', title: 'Check', quiz: quiz() })));
      renderManage(<CourseEditorPage />, PATH);
      return screen.findByRole('region', { name: 'Lessons' });
    };

    it('shows how many people would be finished and certified, then deletes on Delete', async () => {
      api.lessonDeleteImpact.mockResolvedValue({ finishing: 2, certificate: true, published: true });
      const lessons = await openCert();
      await userEvent.click(within(lessons).getByRole('button', { name: 'Delete “Check”' }));
      const confirm = screen.getByRole('alertdialog', { name: 'Delete the quiz?' });
      expect(await within(confirm).findByText('2 people will be marked finished and get the certificate.')).toBeInTheDocument();
      expect(api.lessonDeleteImpact).toHaveBeenCalledWith('q');
      expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(api.deleteLesson).toHaveBeenCalledWith('q'));
    });

    it('one person reads “1 person”; Cancel deletes nothing', async () => {
      api.lessonDeleteImpact.mockResolvedValue({ finishing: 1, certificate: true, published: true });
      const lessons = await openCert();
      await userEvent.click(within(lessons).getByRole('button', { name: 'Delete “Check”' }));
      const confirm = screen.getByRole('alertdialog', { name: 'Delete the quiz?' });
      expect(await within(confirm).findByText('1 person will be marked finished and get the certificate.')).toBeInTheDocument();
      await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(api.deleteLesson).not.toHaveBeenCalled();
    });

    it('Delete waits for the number; no one finishing says so', async () => {
      let answer!: (v: { finishing: number; certificate: boolean; published: boolean }) => void;
      api.lessonDeleteImpact.mockReturnValue(new Promise((r) => (answer = r)));
      const lessons = await openCert();
      await userEvent.click(within(lessons).getByRole('button', { name: 'Delete “Check”' }));
      const confirm = screen.getByRole('alertdialog', { name: 'Delete the quiz?' });
      expect(within(confirm).getByText(/Checking who this would finish/)).toBeInTheDocument();
      expect(within(confirm).getByRole('button', { name: 'Delete' })).toBeDisabled();
      answer({ finishing: 0, certificate: true, published: true });
      expect(await within(confirm).findByText('No one will be marked finished or get the certificate.')).toBeInTheDocument();
      expect(within(confirm).getByRole('button', { name: 'Delete' })).toBeEnabled();
    });

    it('when the number can’t be worked out, it says what may happen and still lets the administrator delete', async () => {
      api.lessonDeleteImpact.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Something went wrong.'));
      const lessons = await openCert();
      await userEvent.click(within(lessons).getByRole('button', { name: 'Delete “Check”' }));
      const confirm = screen.getByRole('alertdialog', { name: 'Delete the quiz?' });
      expect(await within(confirm).findByText(/Anyone who has done every other lesson will be marked finished and get the certificate/)).toBeInTheDocument();
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(api.deleteLesson).toHaveBeenCalledWith('q'));
    });

    it('a quiz of a draft course: the usual question, nothing asked of the server', async () => {
      api.manageCourse.mockResolvedValue(manageCourse({ status: 'DRAFT', certificateOn: true, lessons: [lesson({ id: 'q', kind: 'QUIZ', title: 'Check', quiz: quiz(), position: 0 })] }));
      renderManage(<CourseEditorPage />, PATH);
      const lessons = await screen.findByRole('region', { name: 'Lessons' });
      await userEvent.click(within(lessons).getByRole('button', { name: 'Delete “Check”' }));
      expect(screen.getByRole('alertdialog', { name: 'Delete the lesson “Check”?' })).toBeInTheDocument();
      expect(api.lessonDeleteImpact).not.toHaveBeenCalled();
    });

    it('a guide lesson of a published certificate course: the usual question too', async () => {
      const lessons = await openCert();
      await userEvent.click(within(lessons).getByRole('button', { name: 'Delete “Read”' }));
      expect(screen.getByRole('alertdialog', { name: 'Delete the lesson “Read”?' })).toBeInTheDocument();
      expect(api.lessonDeleteImpact).not.toHaveBeenCalled();
    });
  });

  it('a video lesson: its link is saved (the server’s refusal shown in its words), and the saved video is previewed', async () => {
    const v = lesson({ id: 'v', kind: 'VIDEO', title: 'Watch how' });
    const lessons = await open(v);
    // 12 Nov (R2): a video without its link is simply hidden from learners — it never stops Publish.
    expect(within(lessons).getByText(/Hidden from learners until it has its link/)).toBeInTheDocument();
    let panel = await expand('Watch how');
    expect(within(panel).getByText(/No video yet/)).toBeInTheDocument();
    expect(within(panel).queryByText(/can’t be published/)).toBeNull();
    api.updateLesson.mockRejectedValueOnce(new ApiError(400, 'VALIDATION', 'Use a YouTube or Vimeo link.'));
    await userEvent.type(within(panel).getByRole('textbox', { name: 'YouTube or Vimeo link' }), 'https://example.com/v');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save lesson' }));
    expect(await within(panel).findByText(/Use a YouTube or Vimeo link\./)).toBeInTheDocument();
    const saved = { ...v, videoUrl: 'https://youtu.be/abc123def45', video: { provider: 'YOUTUBE' as const, videoId: 'abc123def45', embedUrl: 'https://www.youtube-nocookie.com/embed/abc123def45', watchUrl: 'https://www.youtube.com/watch?v=abc123def45' } };
    api.updateLesson.mockResolvedValueOnce(saved);
    api.manageCourse.mockResolvedValue(withLessons(saved));
    const link = within(panel).getByRole('textbox', { name: 'YouTube or Vimeo link' });
    await userEvent.clear(link);
    await userEvent.type(link, 'https://youtu.be/abc123def45');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save lesson' }));
    await waitFor(() => expect(api.updateLesson).toHaveBeenLastCalledWith('v', { videoUrl: 'https://youtu.be/abc123def45' }));
    panel = screen.getByRole('form', { name: 'Lesson “Watch how”' }).parentElement!;
    const frame = await within(panel).findByTitle('Video preview: Watch how');
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc123def45');
    expect(within(panel).getByRole('link', { name: 'Open it on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc123def45');
    await waitFor(() => expect(within(lessons).queryByText(/Hidden from learners until it has its link/)).toBeNull());
  });

  it('a lesson’s title and minutes are saved (only what changed)', async () => {
    await open(lesson({ id: 'g', kind: 'GUIDE', title: 'Make a task', minutes: 5 }));
    const panel = await expand('Make a task');
    const minutes = within(panel).getByRole('spinbutton', { name: 'Minutes' });
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '12');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save lesson' }));
    await waitFor(() => expect(api.updateLesson).toHaveBeenCalledWith('g', { minutes: 12 }));
  });
});

describe('Course editor: a document lesson', () => {
  it('uploads the document (kind DOCUMENT, with progress) and attaches it to the lesson', async () => {
    const d = lesson({ id: 'd', kind: 'DOCUMENT', title: 'The handbook' });
    await open(d);
    const panel = await expand('The handbook');
    api.uploadFile.mockImplementation(async (_c, _k, _f, onProgress) => {
      onProgress?.(0.5);
      return fileRef({ id: 'f-doc', name: 'handbook.pdf', kind: 'DOCUMENT' });
    });
    api.updateLesson.mockResolvedValue({ ...d, document: fileRef({ id: 'f-doc', name: 'handbook.pdf', kind: 'DOCUMENT' }) });
    const file = new File(['%PDF'], 'handbook.pdf', { type: 'application/pdf' });
    await userEvent.upload(within(panel).getByLabelText('Upload a document'), file);
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledWith('c1', 'DOCUMENT', file, expect.any(Function)));
    await waitFor(() => expect(api.updateLesson).toHaveBeenCalledWith('d', { fileId: 'f-doc' }));
  });

  it('a file over 25 MB is refused before it is sent', async () => {
    await open(lesson({ id: 'd', kind: 'DOCUMENT', title: 'The handbook' }));
    const panel = await expand('The handbook');
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await userEvent.upload(within(panel).getByLabelText('Upload a document'), big);
    expect(await within(panel).findByText('“huge.pdf” is 26 MB: the most is 25 MB.')).toBeInTheDocument();
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it('remove: the lesson no longer has it and its file is deleted', async () => {
    const doc = fileRef({ id: 'f-old', name: 'old.pdf', kind: 'DOCUMENT' });
    const d = lesson({ id: 'd', kind: 'DOCUMENT', title: 'The handbook', document: doc });
    await open(d);
    const panel = await expand('The handbook');
    expect(within(panel).getByText('old.pdf')).toBeInTheDocument();
    api.updateLesson.mockResolvedValue({ ...d, document: null });
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.updateLesson).toHaveBeenCalledWith('d', { fileId: null }));
    await waitFor(() => expect(api.deleteFile).toHaveBeenCalledWith('f-old'));
  });
});

describe('Course editor: a step-by-step guide', () => {
  const guide = () =>
    lesson({
      id: 'g',
      kind: 'GUIDE',
      title: 'Make a task',
      steps: [
        { id: 's1', position: 0, title: 'Open My Tasks', body: '<p>Click it.</p>', image: null },
        { id: 's2', position: 1, title: 'Press New task', body: null, image: { fileId: 'img1', alt: 'The New task button' } },
      ],
    });

  it('shows one step open at a time (the first, to begin with); the others by their titles', async () => {
    await open(guide());
    const panel = await expand('Make a task');
    const steps = within(panel).getByRole('list', { name: 'Steps' });
    expect(within(steps).getByRole('button', { name: 'Step 1: Open My Tasks' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(steps).getByRole('textbox', { name: 'Step 1 title' })).toHaveValue('Open My Tasks');
    expect(within(steps).getByRole('button', { name: 'Step 2: Press New task' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(steps).queryByRole('textbox', { name: 'Step 2 title' })).toBeNull();
    await userEvent.click(within(steps).getByRole('button', { name: 'Step 2: Press New task' }));
    expect(within(steps).getByRole('textbox', { name: 'Step 2 title' })).toHaveValue('Press New task');
    expect(within(steps).queryByRole('textbox', { name: 'Step 1 title' })).toBeNull();
  });

  it('moves a step up and saves the whole list in the new order', async () => {
    await open(guide());
    const panel = await expand('Make a task');
    const steps = within(panel).getByRole('list', { name: 'Steps' });
    expect(within(steps).getByRole('textbox', { name: 'Step 1 title' })).toHaveValue('Open My Tasks');
    expect(within(panel).getByRole('button', { name: 'Save steps' })).toBeDisabled();
    await userEvent.click(within(steps).getByRole('button', { name: 'Move step 2 up' }));
    expect(within(steps).getByRole('button', { name: 'Step 1: Press New task' })).toBeInTheDocument();
    // The open step moved with its words.
    expect(within(steps).getByRole('textbox', { name: 'Step 2 title' })).toHaveValue('Open My Tasks');
    expect(within(steps).getByRole('button', { name: 'Move step 1 down' })).toHaveFocus();
    expect(within(panel).getByText('Changes not saved yet')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Save steps' }));
    await waitFor(() =>
      expect(api.saveSteps).toHaveBeenCalledWith('g', [
        { title: 'Press New task', body: null, imageFileId: 'img1', imageAlt: 'The New task button' },
        { title: 'Open My Tasks', body: '<p>Click it.</p>', imageFileId: null, imageAlt: null },
      ]),
    );
  });

  it('a picture needs its description; a new picture is uploaded as IMAGE', async () => {
    await open(guide());
    const panel = await expand('Make a task');
    const steps = within(panel).getByRole('list', { name: 'Steps' });
    await userEvent.click(within(steps).getByRole('button', { name: 'Step 2: Press New task' }));
    await userEvent.clear(within(steps).getByRole('textbox', { name: 'Step 2 picture description' }));
    // Another step open: the step with the problem opens again when Save finds it.
    await userEvent.click(within(steps).getByRole('button', { name: 'Step 1: Open My Tasks' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Save steps' }));
    expect(await within(panel).findByText('Step 2: describe its picture for people who can’t see it.')).toBeInTheDocument();
    expect(within(steps).getByRole('textbox', { name: 'Step 2 picture description' })).toBeInTheDocument();
    expect(api.saveSteps).not.toHaveBeenCalled();
    await userEvent.click(within(steps).getByRole('button', { name: 'Step 1: Open My Tasks' }));
    api.uploadFile.mockResolvedValue(fileRef({ id: 'img2', name: 'shot.png', kind: 'IMAGE', mimeType: 'image/png' }));
    const shot = new File(['png'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(within(steps).getByLabelText('Add a picture to step 1'), shot);
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledWith('c1', 'IMAGE', shot, expect.any(Function)));
    expect(await within(steps).findByRole('textbox', { name: 'Step 1 picture description' })).toBeInTheDocument();
  });

  it('adds and removes steps', async () => {
    await open(guide());
    const panel = await expand('Make a task');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add step' }));
    const steps = within(panel).getByRole('list', { name: 'Steps' });
    // A new step opens (the others fold).
    expect(within(steps).queryByRole('textbox', { name: 'Step 1 title' })).toBeNull();
    await userEvent.type(within(steps).getByRole('textbox', { name: 'Step 3 title' }), 'Save it');
    await userEvent.click(within(steps).getByRole('button', { name: 'Remove step 1' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Save steps' }));
    await waitFor(() => expect(api.saveSteps).toHaveBeenCalledWith('g', [expect.objectContaining({ title: 'Press New task' }), expect.objectContaining({ title: 'Save it', imageFileId: null })]));
  });
});

describe('Course editor: a quiz', () => {
  it('is checked before saving: at least one question, the right answers marked', async () => {
    await open(lesson({ id: 'q', kind: 'QUIZ', title: 'Check yourself', quiz: quiz() }));
    const panel = await expand('Check yourself');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Add at least one question.');
    expect(api.saveQuiz).not.toHaveBeenCalled();

    await userEvent.click(within(panel).getByRole('button', { name: 'Add question' }));
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1' }), 'Where do new tasks go?');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1, answer 1' }), 'To do');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1, answer 2' }), 'Done');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Question 1: mark exactly one right answer (of at least two).');
    expect(api.saveQuiz).not.toHaveBeenCalled();

    await userEvent.click(within(panel).getByRole('radio', { name: 'Question 1, answer 1 is right' }));
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1, answer 2: feedback' }), 'Not yet');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    await waitFor(() =>
      expect(api.saveQuiz).toHaveBeenCalledWith('q', {
        passMark: 70,
        maxAttempts: null,
        shuffle: false,
        timeLimitMinutes: null,
        drawCount: null,
        questions: [{ kind: 'SINGLE', prompt: 'Where do new tasks go?', explanation: null, options: [{ text: 'To do', correct: true, feedback: null }, { text: 'Done', correct: false, feedback: 'Not yet' }] }],
      }),
    );
  });

  it('true/false has fixed answers; multiple choice needs a right one; the settings are sent', async () => {
    await open(lesson({ id: 'q', kind: 'QUIZ', title: 'Check yourself', quiz: quiz() }));
    const panel = await expand('Check yourself');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add question' }));
    await userEvent.selectOptions(within(panel).getByRole('combobox', { name: 'Question 1: kind' }), 'TRUE_FALSE');
    expect(within(panel).getByRole('textbox', { name: 'Question 1, answer 1' })).toHaveValue('True');
    expect(within(panel).getByRole('textbox', { name: 'Question 1, answer 1' })).toHaveAttribute('readonly');
    expect(within(panel).queryByRole('button', { name: 'Remove Question 1, answer 1' })).toBeNull();
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1' }), 'A task can be undone');
    await userEvent.click(within(panel).getByRole('radio', { name: 'Question 1, answer 2 is right' }));

    await userEvent.click(within(panel).getByRole('button', { name: 'Add question' }));
    await userEvent.selectOptions(within(panel).getByRole('combobox', { name: 'Question 2: kind' }), 'MULTIPLE');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 2' }), 'Which are statuses?');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 2, answer 1' }), 'To do');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 2, answer 2' }), 'Banana');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Question 2: mark at least one right answer (of at least two).');
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Question 2, answer 1 is right' }));

    const pass = within(panel).getByRole('spinbutton', { name: 'Pass mark (%)' });
    await userEvent.clear(pass);
    await userEvent.type(pass, '80');
    await userEvent.click(within(panel).getByRole('switch', { name: 'Unlimited attempts' }));
    const attempts = within(panel).getByRole('spinbutton', { name: 'Attempts allowed' });
    await userEvent.clear(attempts);
    await userEvent.type(attempts, '2');
    // Time limit, question bank and shuffle are folded under More options (closed while none is on).
    expect(within(panel).queryByRole('switch', { name: 'Time limit' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'More options' }));
    expect(within(panel).getByRole('button', { name: 'More options' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(within(panel).getByRole('switch', { name: 'Time limit' }));
    await userEvent.click(within(panel).getByRole('switch', { name: 'Shuffle the questions' }));
    await userEvent.click(within(panel).getByRole('switch', { name: 'Question bank' }));
    const draw = within(panel).getByRole('spinbutton', { name: 'Questions drawn for each attempt' });
    await userEvent.clear(draw);
    await userEvent.type(draw, '3');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('The quiz draws 3 questions but has only 2.');
    await userEvent.clear(draw);
    await userEvent.type(draw, '1');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    await waitFor(() =>
      expect(api.saveQuiz).toHaveBeenCalledWith('q', {
        passMark: 80,
        maxAttempts: 2,
        shuffle: true,
        timeLimitMinutes: 10,
        drawCount: 1,
        questions: [
          { kind: 'TRUE_FALSE', prompt: 'A task can be undone', explanation: null, options: [{ text: 'True', correct: false, feedback: null }, { text: 'False', correct: true, feedback: null }] },
          { kind: 'MULTIPLE', prompt: 'Which are statuses?', explanation: null, options: [{ text: 'To do', correct: true, feedback: null }, { text: 'Banana', correct: false, feedback: null }] },
        ],
      }),
    );
  });

  it('More options stays folded for a shuffled quiz (every starter quiz) and opens for a time limit (review M8)', async () => {
    await open(lesson({ id: 'q', kind: 'QUIZ', title: 'Check yourself', quiz: quiz({ shuffle: true }) }));
    const panel = await expand('Check yourself');
    expect(within(panel).getByRole('button', { name: 'More options' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(within(panel).getByRole('button', { name: 'More options' }));
    expect(within(panel).getByRole('switch', { name: 'Shuffle the questions' })).toHaveAttribute('aria-checked', 'true');
  });

  it('More options is open from the start when the quiz has a time limit', async () => {
    await open(lesson({ id: 'q', kind: 'QUIZ', title: 'Check yourself', quiz: quiz({ timeLimitMinutes: 10 }) }));
    const panel = await expand('Check yourself');
    expect(within(panel).getByRole('button', { name: 'More options' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('put in order: the steps are written in the right order and can be moved', async () => {
    await open(lesson({ id: 'q', kind: 'QUIZ', title: 'Check yourself', quiz: quiz() }));
    const panel = await expand('Check yourself');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add question' }));
    await userEvent.selectOptions(within(panel).getByRole('combobox', { name: 'Question 1: kind' }), 'ORDER');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1' }), 'Put in order');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1, step 1' }), 'Close it');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1, step 2' }), 'Open it');
    await userEvent.click(within(panel).getByRole('button', { name: 'Move Question 1, step 2 up' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    await waitFor(() => expect(api.saveQuiz).toHaveBeenCalledWith('q', expect.objectContaining({ questions: [{ kind: 'ORDER', prompt: 'Put in order', explanation: null, options: [{ text: 'Open it', correct: true, feedback: null }, { text: 'Close it', correct: true, feedback: null }] }] })));
  });

  it('a saved quiz’s questions keep their ids (the per-question report follows them)', async () => {
    const saved = quiz({ questions: [{ id: 'q1', kind: 'SINGLE', prompt: 'Where?', explanation: null, options: [{ id: 'o1', text: 'Here', correct: true, feedback: null }, { id: 'o2', text: 'There', correct: false, feedback: null }] }] });
    await open(lesson({ id: 'q', kind: 'QUIZ', title: 'Check yourself', quiz: saved }));
    const panel = await expand('Check yourself');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Question 1' }), ' exactly');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save quiz' }));
    await waitFor(() => expect(api.saveQuiz).toHaveBeenCalledWith('q', expect.objectContaining({ questions: [expect.objectContaining({ id: 'q1', prompt: 'Where? exactly', options: [expect.objectContaining({ id: 'o1' }), expect.objectContaining({ id: 'o2' })] })] })));
  });
});

describe('Course editor: downloads', () => {
  it('uploads a download (kind RESOURCE) and removes one after asking — a refusal is said in the server’s words', async () => {
    api.manageCourse.mockResolvedValue(manageCourse({ resources: [fileRef({ id: 'r1', name: 'Tasks guide.pdf', sizeBytes: 3_600_000 })] }));
    renderManage(<CourseEditorPage />, PATH);
    const downloads = await screen.findByRole('region', { name: 'Downloads' });
    expect(within(downloads).getByText('Tasks guide.pdf')).toBeInTheDocument();
    expect(within(downloads).getByText('3.4 MB')).toBeInTheDocument();
    const file = new File(['x'], 'checklist.xlsx');
    await userEvent.upload(within(downloads).getByLabelText('Upload a file'), file);
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledWith('c1', 'RESOURCE', file, expect.any(Function)));
    api.deleteFile.mockRejectedValueOnce(new ApiError(409, 'FILE_IN_USE', 'This file is used by the lesson “Read it”. Remove it there first.'));
    await userEvent.click(within(downloads).getByRole('button', { name: 'Remove Tasks guide.pdf' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Remove “Tasks guide.pdf”?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove file' }));
    expect(await within(confirm).findByText(/Remove it there first\./)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove file' }));
    await waitFor(() => expect(api.deleteFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});
