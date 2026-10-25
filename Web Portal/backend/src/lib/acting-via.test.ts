import { describe, it, expect } from 'vitest';
import { actingVia, currentVia } from './acting-via';

describe('acting via MICO AI: what is written while MICO AI carries out a change is marked as such', () => {
  it('is set inside, through awaits and timers, and only there', async () => {
    expect(currentVia()).toBeNull();
    const seen = await actingVia('mico-ai', async () => {
      const first = currentVia();
      await new Promise((r) => setTimeout(r, 1));
      const later = await Promise.resolve().then(() => currentVia());
      return [first, later];
    });
    expect(seen).toEqual(['mico-ai', 'mico-ai']);
    expect(currentVia()).toBeNull();
  });

  it('two at once never see each other’s', async () => {
    const plain = new Promise<string | null>((resolve) => setTimeout(() => resolve(currentVia()), 5));
    const marked = actingVia('mico-ai', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return currentVia();
    });
    expect(await Promise.all([plain, marked])).toEqual([null, 'mico-ai']);
  });

  it('a failure inside still ends it', async () => {
    await expect(actingVia('mico-ai', async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
    expect(currentVia()).toBeNull();
  });
});
