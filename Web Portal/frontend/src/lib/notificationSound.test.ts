import { describe, it, expect, beforeEach } from 'vitest';
import { isChatMuted, setChatMuted, playChime, primeAudio } from './notificationSound';

describe('chat mute preference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to unmuted', () => {
    expect(isChatMuted()).toBe(false);
  });

  it('persists the mute preference', () => {
    setChatMuted(true);
    expect(isChatMuted()).toBe(true);
    setChatMuted(false);
    expect(isChatMuted()).toBe(false);
  });
});

describe('sound playback', () => {
  it('is a no-op (never throws) when Web Audio is unavailable', () => {
    expect(() => playChime()).not.toThrow();
    expect(() => primeAudio()).not.toThrow();
  });
});
