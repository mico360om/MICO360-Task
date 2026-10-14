import { describe, it, expect } from 'vitest';
import { directMessageTitle } from './chat-notices';

describe('directMessageTitle', () => {
  it('names the sender', () => {
    expect(directMessageTitle('Aisha Khan', 1)).toBe('New message from Aisha Khan');
  });

  it('counts the messages waiting from that person', () => {
    expect(directMessageTitle('Aisha Khan', 3)).toBe('3 new messages from Aisha Khan');
  });

  it('falls back to plain wording when the sender is unknown or the count is not', () => {
    expect(directMessageTitle('', 1)).toBe('New direct message');
    expect(directMessageTitle(null, 4)).toBe('4 new direct messages');
    expect(directMessageTitle('Aisha Khan', 0)).toBe('New message from Aisha Khan');
  });
});
