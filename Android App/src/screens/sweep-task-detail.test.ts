import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';
import { attachmentIcon } from '../lib/attachments';

/** The Task 17 sweep: the task screen and the task form in the website's look. */
const GROUP = [
  'components/Mentions.tsx',
  'components/RecurrenceEditor.tsx',
  'components/task-detail/DetailsCard.tsx',
  'components/task-detail/FilePreviewSheet.tsx',
  'components/task-detail/HeaderCard.tsx',
  'components/task-detail/InfoCards.tsx',
  'components/task-detail/WorkCards.tsx',
  'components/task-detail/kit.tsx',
  'components/task-form/AssigneeField.tsx',
  'components/task-form/DescribeTask.tsx',
  'components/task-form/DueDateField.tsx',
  'components/task-form/FilesField.tsx',
  'lib/attachments.ts',
  'screens/NewTaskScreen.tsx',
  'screens/TaskDetailScreen.tsx',
];

it('the Approval section shows the chip while it waits', () => expect(src('components/approvals/TaskApproval.tsx')).toMatch(/view\.waiting \? [^]*<ApprovalChip size="sm"/));

it('switches are Toggles', () => {
  for (const f of GROUP) expect(src(f), f).not.toMatch(/import \{[^}]*\bSwitch\b[^}]*\} from 'react-native'/);
  expect(src('components/task-detail/DetailsCard.tsx')).toMatch(/<Toggle\s+on=\{!!task\.isMilestone\}/);
});

it('the task kit no longer draws glyph buttons', () => {
  expect(src('components/task-detail/kit.tsx')).not.toMatch(/export function IconButton/);
  for (const f of ['DetailsCard', 'HeaderCard', 'InfoCards', 'WorkCards']) {
    const s = src(`components/task-detail/${f}.tsx`);
    expect(s, f).toMatch(/import \{[^}]*\bIconButton\b[^}]*\} from '\.\.\/ui';/);
    expect(s, f).not.toMatch(/glyph=/);
  }
});

it('attachments draw the file icon', () => expect(attachmentIcon('application/pdf')).toBe('ui.file'));

it('the header: priority badge, meeting line with the calendar and a chevron, the title’s edit button', () => {
  const s = src('components/task-detail/HeaderCard.tsx');
  expect(s).toMatch(/<PriorityBadge priority=\{task\.priority\} \/>/);
  expect(s).toMatch(/name="kit\.calendar"[^]*?<Icon name="ui\.chevron" rotate=\{270\}/);
  expect(s).toMatch(/<IconButton icon="ui\.edit" label="Edit title"/);
});

it('checklist steps move with up/down icon buttons; saved says so with the check', () => {
  const work = src('components/task-detail/WorkCards.tsx');
  expect(work).toMatch(/<IconButton icon="kit\.up" label=/);
  expect(work).toMatch(/<IconButton icon="kit\.down" label=/);
  const kit = src('components/task-detail/kit.tsx');
  expect(kit).toMatch(/state\.status === 'saved' \? 'Saved'/);
  expect(kit).toMatch(/<Icon name="misc\.check"/);
});

it('a first load shows skeletons on the task screen and the edit form', () => {
  for (const f of ['screens/TaskDetailScreen.tsx', 'screens/NewTaskScreen.tsx']) expect(src(f), f).toMatch(/<SkeletonList /);
});
