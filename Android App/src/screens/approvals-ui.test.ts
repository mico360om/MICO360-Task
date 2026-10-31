import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

// Stage 2 Task 3: the Approval section on a task (the website's TaskApproval), its Send back sheet and the actions.
it('the switch is disabled whenever it is locked', () => expect(src('components/approvals/TaskApproval.tsx')).toMatch(/<Toggle[^>]*disabled=\{view\.tick\.locked/));
it('Send back checks the reason before sending, and the box stops at 2000', () => { const s = src('components/approvals/SendBackSheet.tsx'); expect(s).toMatch(/maxLength=\{REASON_MAX\}/); expect(s).toMatch(/sendBackCheck\(/); });
it('decisions go to the server now, never kept for later', () => { const s = src('core/approval-queries.ts'); expect(s).not.toMatch(/sendInOrder|queueOnOffline|itemLanes/); expect(s).toMatch(/owned\(services\)/); });
it('a refused change shows in words through failureText (the server’s own sentence when it gives one)', () => expect(src('components/approvals/TaskApproval.tsx')).toMatch(/failureText\(e, APPROVAL_SECTION_TEXT\.setFailed\)/));
it('the header leaves the waiting chip to the Approval section', () => { expect(src('components/task-detail/HeaderCard.tsx')).not.toMatch(/<ApprovalChip/); expect(src('components/approvals/TaskApproval.tsx')).toMatch(/view\.waiting \? [^]*<ApprovalChip size="sm"/); });
it('a decision lays the server’s answer over the task and refreshes; a refusal reloads the task', () => {
  const s = src('core/approval-queries.ts');
  expect(s).toMatch(/afterApprovalDecision\(qc, t\.id, answer\)/);
  expect(s).toMatch(/afterApprovalRefused\(qc, t\.id\)/);
});
it('turning approval off while it waits asks first, in the website’s words', () => {
  const s = src('components/approvals/TaskApproval.tsx');
  expect(s).toMatch(/view\.waiting && !next[^]*setConfirmOff\(true\)/);
  for (const w of ['offTitle', 'offBody', 'offConfirm', 'offKeep']) expect(s, w).toContain(`APPROVAL_SECTION_TEXT.${w}`);
});
it('Approve and Send back are named for the task, and say so when done', () => {
  const s = src('components/approvals/TaskApproval.tsx');
  expect(s).toMatch(/accessibilityLabel=\{approveLabel\(task\.key\)\}/); expect(s).toMatch(/accessibilityLabel=\{sendBackLabel\(task\.key\)\}/);
  expect(s).toMatch(/notice\(approvedNotice\(task\.key\)\)/); expect(s).toMatch(/notice\(sentBackNotice\(task\.key\)\)/);
});
it('the task screen shows the Approval section, first while it waits', () => {
  const s = src('screens/TaskDetailScreen.tsx');
  expect(s).toMatch(/taskSections\(\{ wide, waiting: isWaitingForApproval\(task\), approval: true \}\)/);
  expect(s).toMatch(/approval: <TaskApproval task=\{task\} \/>/);
});
