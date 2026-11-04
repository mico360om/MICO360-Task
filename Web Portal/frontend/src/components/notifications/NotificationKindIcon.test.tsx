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
