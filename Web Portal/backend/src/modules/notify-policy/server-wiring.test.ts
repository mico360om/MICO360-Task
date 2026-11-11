import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Found by the battery: the server's @mention notifier dropped the notice's own email (the comment quote)
// because its notify wrapper passed only the notice — the plain notice email went instead. Every wrapper
// that hands notify options (a notice's own email, a meeting reminder's push and start) must pass them on.
const server = readFileSync(resolve(__dirname, '../../server.ts'), 'utf8');
const block = (name: string) => {
  const at = server.indexOf(name);
  return at < 0 ? '' : server.slice(at, server.indexOf('\n  });', at));
};

describe('notify options reach the notification service', () => {
  it('the @mention notifier passes its own email (the comment quote)', () => {
    expect(block('onCommentMention = createMentionNotifier({')).toContain('notify: (input, opts) => notificationService.notify(input, opts)');
  });
  it('meeting reminders pass their push and their start', () => {
    expect(block('createMeetingReminderService({')).toContain('notify: (input, opts) => notificationService.notify(input, opts)');
  });
});
