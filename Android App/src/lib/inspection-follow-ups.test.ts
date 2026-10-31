import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { DETAIL } from '../testing/inspection-fixtures';
import { websiteSays } from '../testing/phone-words';
import { detailView } from './inspection-outbox';
import { FOLLOW_UP_WORDS, allButton, assigneeOf, failedWithout, followUpChoices } from './inspection-follow-ups';
import type { ApiMember } from './types';

/** Follow-up tasks from failed inspection items (Stage 4 Task 9). */

const member = (id: string, firstName: string, lastName: string): ApiMember => ({ id, username: `${firstName}.${lastName}`.toLowerCase(), email: `${id}@x.om`, firstName, lastName, role: 'MEMBER' });

it('new follow-up tasks go to the owner, a member or nobody', () => {
  const members = [member('u1', 'Ann', 'Lee'), member('u2', 'Omar', 'Ali')];
  expect(followUpChoices(members, { id: 'u2' })).toEqual([
    { value: '~default', label: 'The project owner (Omar Ali)' },
    { value: 'u1', label: 'Ann Lee' },
    { value: 'u2', label: 'Omar Ali' },
    { value: '~nobody', label: 'Nobody yet' },
  ]);
  expect(followUpChoices(members, { id: 'u9' })[0]).toEqual({ value: '~default', label: 'The project owner' });
  expect(followUpChoices([], null)).toEqual([
    { value: '~default', label: 'The project owner' },
    { value: '~nobody', label: 'Nobody yet' },
  ]);
  expect([assigneeOf('~default'), assigneeOf('~nobody'), assigneeOf('u1')]).toEqual([undefined, null, 'u1']);
});

it('the all button counts only items with no task and none asked for on the phone', () => {
  const view = {
    ...detailView(DETAIL),
    followUpsWaiting: ['p'],
    snapshot: {
      ...DETAIL,
      followUps: [
        { itemId: 'q', task: { id: 't9', key: 'RIG-9', title: 'Fix', deleted: false, done: false }, pending: false },
        { itemId: 's', task: null, pending: true },
      ],
    },
  };
  expect(failedWithout(view, ['p', 'q', 'r', 's'])).toEqual(['r']);
  expect(allButton(1)).toEqual({ label: 'Create tasks for all failed items (1)', disabled: false });
  expect(allButton(0)).toEqual({ label: 'Every failed item has a task', disabled: true });
});

it('asks for them through the outbox and sends at once', () => expect(src('components/inspections/FailedItemsCard.tsx')).toMatch(/queueFollowUps\(ownerId, inspectionId, [^)]*assigneeOf\(choice\)[^)]*\)[^]*send\(\)/));

it('one item’s button asks the same way, from the screen', () => {
  const s = src('screens/InspectionScreen.tsx');
  expect(s).toMatch(/<FailedItemsCard/);
  expect(s).toMatch(/onMakeFollowUp=\{/);
  expect(s).toMatch(/followUpNotice\(report, /);
  expect(s).toMatch(/ackFollowUpReport\(ownerId, inspectionId\)/);
});

describe.skipIf(!hasWeb('frontend/src/pages/InspectionPage.tsx', 'frontend/src/components/inspections/InspectionItem.tsx'))('the website’s follow-up words', () => {
  it('are the same', () => {
    const web = [readWeb('frontend/src/pages/InspectionPage.tsx'), readWeb('frontend/src/components/inspections/InspectionItem.tsx')];
    for (const [k, w] of Object.entries(FOLLOW_UP_WORDS)) expect(websiteSays(web, w), k).toBe(true);
    for (const w of [allButton(3).label.replace('(3)', '({n})'), allButton(0).label, 'The project owner', 'Nobody yet']) expect(websiteSays(web, w), w).toBe(true);
  });
});
