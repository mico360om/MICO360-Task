import { describe, it, expect } from 'vitest';
import { APPROVAL_SECTION_TEXT, SEND_BACK_TOO_LONG, TO_APPROVE_SUB, approvalView, sendBackCheck, toApproveRows, toApproveTitle } from './approval-section';
import type { ApprovalTask } from './types';
import { APPROVAL_HINT, APPROVAL_LOCKED } from './approvals';
import { failureText } from './task-detail';
import { ApiError } from './api-client';
import { hasWeb, readWeb } from '../testing/web-source';

const NOW = Date.parse('2026-10-30T08:00:00Z');
const TZ = 'Asia/Muscat';

const asked = { needsApproval: true, approvalRequestedAt: '2026-10-30T06:00:00Z', columnCategory: 'REVIEW', completedAt: null };
const info = (canApprove: boolean, approverName: string | null = 'Aisha Khan') => ({ canApprove, requestedBy: { id: 'u2', name: 'Sara Ali' }, approvedBy: null, approverName });

describe('approvalView — the website’s TaskApproval section', () => {
  it('a project manager decides; anyone else sees whose approval it waits for', () => {
    expect(approvalView({ ...asked, approval: info(true) }, NOW, TZ)).toMatchObject({ waiting: true, decide: true, waitingFor: null, finishedLine: 'Finished by Sara Ali · 2h ago' });
    expect(approvalView({ ...asked, approval: info(false) }, NOW, TZ)).toMatchObject({ decide: false, waitingFor: 'Waiting for Aisha Khan’s approval' });
    expect(approvalView({ ...asked, approval: info(false, null) }, NOW, TZ).waitingFor).toBe('Waiting for a project manager’s approval');
  });
  it('who finished it is said only when the server names them', () => {
    expect(approvalView({ ...asked, approval: { ...info(true), requestedBy: null } }, NOW, TZ).finishedLine).toBeNull();
    expect(approvalView({ ...asked }, NOW, TZ)).toMatchObject({ waiting: true, decide: false, finishedLine: null, waitingFor: 'Waiting for a project manager’s approval' });
  });
  it('a finished, approved task says who approved it and when; nothing while it waits or before it is done', () => {
    const approved = { needsApproval: true, approvalRequestedAt: null, approvedAt: '2026-10-29T08:00:00Z', completedAt: '2026-10-29T08:00:00Z', approval: { ...info(true), approvedBy: { id: 'u1', name: 'Aisha Khan' } } };
    expect(approvalView(approved, NOW, TZ)).toMatchObject({ waiting: false, decide: false, waitingFor: null, finishedLine: null, approvedLine: 'Approved by Aisha Khan · 1d ago' });
    expect(approvalView({ ...approved, completedAt: null }, NOW, TZ).approvedLine).toBeNull();
    expect(approvalView({ ...asked, approval: { ...info(true), approvedBy: { id: 'u1', name: 'Aisha Khan' } } }, NOW, TZ).approvedLine).toBeNull();
  });
  it('Review Focus 1: a non-manager sees the switch on and locked, with the website’s note', () => {
    expect(approvalView({ ...asked, approval: info(false) }, NOW, TZ).tick).toEqual({ on: true, locked: true, lockNote: APPROVAL_LOCKED, hint: APPROVAL_HINT });
    expect(approvalView({ needsApproval: true }, NOW, TZ).tick.locked).toBe(true); // an answer without `approval`
    expect(approvalView({ needsApproval: false, approval: info(false) }, NOW, TZ).tick.locked).toBe(false); // anyone may turn it on
    expect(approvalView({ needsApproval: true, approval: info(true) }, NOW, TZ).tick.locked).toBe(false);
    expect(approvalView({ needsApproval: false, approval: info(false) }, NOW, TZ).tick).toEqual({ on: false, locked: false, lockNote: null, hint: APPROVAL_HINT });
  });
  it('Review Focus 1: the server’s refusal is shown in its own words', () => {
    const words = 'Only the project’s managers can turn off approval for this task.';
    expect(failureText(new ApiError(403, 'FORBIDDEN', words), APPROVAL_SECTION_TEXT.setFailed)).toBe(words);
  });
});

describe('sendBackCheck', () => {
  it('Review Focus 2: Send back needs a reason, trimmed, 2000 characters at most', () => {
    expect(sendBackCheck('')).toEqual({ ok: false, message: 'Write a reason first.' });
    expect(sendBackCheck('   \n ')).toEqual({ ok: false, message: 'Write a reason first.' });
    expect(sendBackCheck('  Readings missing ')).toEqual({ ok: true, reason: 'Readings missing' });
    expect(sendBackCheck(` ${'x'.repeat(2000)} `)).toEqual({ ok: true, reason: 'x'.repeat(2000) });
    expect(sendBackCheck('x'.repeat(2001))).toEqual({ ok: false, message: 'Keep the reason under 2000 characters.' });
  });
});

const SERVER = 'backend/src/modules/tasks/task-service.ts';
const SERVER_RULES = 'backend/src/modules/tasks/task-approval.ts';
describe.skipIf(!hasWeb('frontend/src/components/approvals/TaskApproval.tsx', SERVER, SERVER_RULES))('the website’s and the server’s words', () => {
  it('every Approval section word', () => {
    const web = readWeb('frontend/src/components/approvals/TaskApproval.tsx');
    for (const w of Object.values(APPROVAL_SECTION_TEXT)) expect(web, w).toContain(w);
  });
  it('the server’s limits and refusal', () => {
    const s = readWeb(SERVER);
    // The server writes its limit into the sentence: `Keep the reason under ${SEND_BACK_REASON_MAX} characters.`
    const max = /export const SEND_BACK_REASON_MAX = (\d+);/.exec(readWeb(SERVER_RULES))?.[1];
    expect(max).toBe('2000');
    expect(s).toContain('longReason: `Keep the reason under ${SEND_BACK_REASON_MAX} characters.`');
    expect(SEND_BACK_TOO_LONG).toBe(`Keep the reason under ${max} characters.`);
    expect(s).toContain('Only the project’s managers can turn off approval for this task.');
  });
});

/** row(id, key, requestedAt): an ApprovalTask in project Rig, finished by Sara Ali at requestedAt. */
const row = (id: string, key: string, requestedAt: string): ApprovalTask => ({
  id, key, title: `Task ${key}`, description: null, projectId: 'p1', columnId: 'c-review', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 0, completedAt: null,
  needsApproval: true, approvalRequestedAt: requestedAt, version: 2,
  project: { id: 'p1', code: 'RIG', name: 'Rig', color: '#8B1E1E', icon: null, imageUrl: null },
  requestedBy: { id: 'u2', name: 'Sara Ali' },
});

describe('To approve in My Tasks', () => {
  it('To approve lists the server’s rows in its order, with the website’s words', () => {
    const data = { canApprove: true, tasks: [row('t2', 'RIG-9', '2026-10-28T08:00:00Z'), row('t1', 'RIG-3', '2026-10-29T08:00:00Z')] };
    expect(toApproveRows(data, NOW, TZ).map((r) => [r.task.id, r.approveLabel, r.sendBackLabel])).toEqual([['t2', 'Approve RIG-9', 'Send RIG-9 back'], ['t1', 'Approve RIG-3', 'Send RIG-3 back']]);
    expect(toApproveRows(undefined, NOW, TZ)).toEqual([]); expect(toApproveTitle(2)).toBe('To approve (2)');
  });
  it('each row says who finished it and when, when the server names them', () => {
    const data = { canApprove: true, tasks: [row('t2', 'RIG-9', '2026-10-28T08:00:00Z'), { ...row('t1', 'RIG-3', '2026-10-29T08:00:00Z'), requestedBy: null }] };
    expect(toApproveRows(data, NOW, TZ).map((r) => r.finishedLine)).toEqual(['Finished by Sara Ali · 2d ago', null]);
  });
});
describe.skipIf(!hasWeb('frontend/src/components/approvals/ToApproveSection.tsx'))('the website’s To approve words', () => {
  it('heading and note', () => { const web = readWeb('frontend/src/components/approvals/ToApproveSection.tsx'); expect(web).toContain(TO_APPROVE_SUB); expect(web).toContain('To approve ('); });
});
