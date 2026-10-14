import { describe, it, expect, vi } from 'vitest';
import { createMentionNotifier, type MentionNotifierDeps } from './mention-notifier';

function deps(over: Partial<MentionNotifierDeps> = {}) {
  const people: Record<string, { id: string; email: string | null }> = {
    omar: { id: 'u-omar', email: 'omar@x.co' },
    sara: { id: 'u-sara', email: 'sara@x.co' },
    noemail: { id: 'u-none', email: null },
    outsider: { id: 'u-out', email: 'out@x.co' },
  };
  const base: MentionNotifierDeps = {
    usersByUsername: vi.fn(async (names: string[]) => names.map((n) => people[n]).filter((p): p is { id: string; email: string | null } => !!p)),
    // The outsider can't open the task; the author never hears about their own comment.
    visibleRecipients: vi.fn(async (_taskId: string, ids: string[], authorId: string) => ids.filter((id) => id !== 'u-out' && id !== authorId)),
    notify: vi.fn(async (input: { userId: string }) => ({ id: `n-${input.userId}` })),
    task: vi.fn(async () => ({ key: 'FAL-7', title: 'Book the venue' })),
    authorName: vi.fn(async () => 'Aisha Khan'),
    sendMentionEmail: vi.fn(async () => {}),
    appUrl: 'https://app.example.com/',
    logger: { warn: vi.fn() },
  };
  return { ...base, ...over };
}

describe('mention notifier', () => {
  it('notifies each mentioned person who can open the task, in the app and by email', async () => {
    const d = deps();
    await createMentionNotifier(d)('t1', 'u-author', ['omar', 'sara', 'outsider'], 'Please check @omar and @sara');
    expect((d.notify as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].userId)).toEqual(['u-omar', 'u-sara']);
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'MENTION', entityType: 'task', entityId: 't1' }));
    const mails = (d.sendMentionEmail as ReturnType<typeof vi.fn>).mock.calls;
    expect(mails.map((c) => c[0])).toEqual(['omar@x.co', 'sara@x.co']);
    expect(mails[0]![1]).toEqual({ mentionedBy: 'Aisha Khan', taskKey: 'FAL-7', taskTitle: 'Book the venue', snippet: 'Please check @omar and @sara', link: 'https://app.example.com/my-tasks?task=t1' });
  });

  it('sends no email to someone who muted mentions (no notification was kept)', async () => {
    const d = deps({ notify: vi.fn(async (input: { userId: string }) => (input.userId === 'u-omar' ? null : { id: 'n' })) });
    await createMentionNotifier(d)('t1', 'u-author', ['omar', 'sara'], 'hi @omar @sara');
    expect((d.sendMentionEmail as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['sara@x.co']);
  });

  it('keeps the in-app notification for someone without an email address', async () => {
    const d = deps();
    await createMentionNotifier(d)('t1', 'u-author', ['noemail'], 'hi @noemail');
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.sendMentionEmail).not.toHaveBeenCalled();
  });

  it('never fails the comment when an email can’t be sent', async () => {
    const d = deps({ sendMentionEmail: vi.fn(async () => { throw new Error('mail down'); }) });
    await expect(createMentionNotifier(d)('t1', 'u-author', ['omar', 'sara'], 'hi')).resolves.toBeUndefined();
    expect(d.sendMentionEmail).toHaveBeenCalledTimes(2);
    expect(d.logger!.warn).toHaveBeenCalled();
  });

  it('shortens a long comment in the email', async () => {
    const d = deps();
    await createMentionNotifier(d)('t1', 'u-author', ['omar'], `@omar ${'word '.repeat(200)}`);
    const snippet = (d.sendMentionEmail as ReturnType<typeof vi.fn>).mock.calls[0]![1].snippet as string;
    expect(snippet.length).toBeLessThanOrEqual(280);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
