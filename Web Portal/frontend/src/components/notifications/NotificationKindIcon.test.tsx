import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NotificationKindIcon, notificationKindLook } from './NotificationKindIcon';

// 1.22 (§10): the notices of AI work finished in the background have their own icon and name.
describe('the AI notices’ icons', () => {
  it('ready and failed, for the minutes’ AI draft and for MICO AI', () => {
    expect(notificationKindLook('AI_DRAFT_READY')).toEqual({ id: 'ai', name: 'AI draft ready' });
    expect(notificationKindLook('AI_DRAFT_FAILED')).toEqual({ id: 'ai-failed', name: 'AI draft failed' });
    expect(notificationKindLook('MICO_AI_ANSWER')).toEqual({ id: 'ai', name: 'MICO AI answer' });
    expect(notificationKindLook('MICO_AI_FAILED')).toEqual({ id: 'ai-failed', name: 'MICO AI couldn’t answer' });
    const { container } = render(<NotificationKindIcon type="MICO_AI_ANSWER" />);
    expect(container.querySelector('[data-kind-icon="ai"] svg path')).not.toBeNull();
  });
});

// 1.23: a client accepted a task or sent it back (shown with the approvals).
describe('the client sign-off notice’s icon', () => {
  it('has its own name, in the approvals’ colours', () => {
    expect(notificationKindLook('TASK_CLIENT_SIGN_OFF')).toEqual({ id: 'client-sign-off', name: 'Client sign-off' });
    const { container } = render(<NotificationKindIcon type="TASK_CLIENT_SIGN_OFF" />);
    const icon = container.querySelector('[data-kind-icon="client-sign-off"]');
    expect(icon?.className).toContain('text-success');
    expect(icon?.querySelector('svg path')).not.toBeNull();
  });
});

// Notification & Scheduling centre: the new reminders have their own names.
describe('the Notification & Scheduling notices’ icons', () => {
  it('escalation to admins, approval waiting, no activity', () => {
    expect(notificationKindLook('TASK_ESCALATION_ADMIN')).toEqual({ id: 'overdue', name: 'Escalation to admins' });
    expect(notificationKindLook('TASK_APPROVAL_WAITING')).toEqual({ id: 'approval', name: 'Approval waiting' });
    expect(notificationKindLook('TASK_INACTIVE')).toEqual({ id: 'inactive', name: 'No activity' });
    const { container } = render(<NotificationKindIcon type="TASK_INACTIVE" />);
    expect(container.querySelector('[data-kind-icon="inactive"] svg path')).not.toBeNull();
  });
});
