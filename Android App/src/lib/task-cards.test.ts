import { it, expect } from 'vitest';
import { taskSections } from './task-detail';
import { withTaskCards } from './task-cards';

/** Where Stage 4's cards sit among the task screen's sections — the website's TaskDrawer order. */
it('Client view sits before the approval, files and blockers: after the comments on a phone, under the details beside the work', () => {
  expect(withTaskCards(taskSections({ wide: false, waiting: false, approval: true }), { client: true })).toEqual({
    top: [],
    main: ['description', 'details', 'checklist', 'comments', 'client', 'approval', 'files', 'blockers', 'activity'],
    side: [],
  });
  expect(withTaskCards(taskSections({ wide: true, waiting: false, approval: true }), { client: true }).side).toEqual(['details', 'client', 'approval', 'files', 'blockers']);
  // Waiting for approval: the approval is on top; Client view still leads the rest.
  const waiting = withTaskCards(taskSections({ wide: false, waiting: true, approval: true }), { client: true });
  expect(waiting.top).toEqual(['approval']);
  expect(waiting.main).toEqual(['description', 'details', 'checklist', 'comments', 'client', 'files', 'blockers', 'activity']);
});

it('without the right to change it, there is no Client view card', () => {
  const plain = taskSections({ wide: false, waiting: false, approval: true });
  expect(withTaskCards(plain, { client: false })).toEqual(plain);
});
