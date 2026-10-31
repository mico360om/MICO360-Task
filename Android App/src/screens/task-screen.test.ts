import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

// Stage 2 Task 2: the task screen as the website's TaskDrawer — its header marks and its section order.
it('the header shows the old numbers and the inspection and client marks', () => {
  const s = src('components/task-detail/HeaderCard.tsx');
  expect(s).toMatch(/formerKeysText\(task\.formerKeys\)/); expect(s).toMatch(/task\.inspectionFormId \? <InspectionChip size="sm"/); expect(s).toMatch(/task\.clientVisible \? <ClientChip/);
});
it('the screen lays out its sections by taskSections', () => expect(src('screens/TaskDetailScreen.tsx')).toMatch(/taskSections\(\{ wide, waiting: isWaitingForApproval\(task\), approval: /));
