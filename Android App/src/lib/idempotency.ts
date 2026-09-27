/**
 * Client-generated `Idempotency-Key` values (XP-06). A key is minted ONCE per user action — before
 * the first attempt — and re-sent unchanged on every retry and on the offline-queue replay, so the
 * server can replay its first response instead of creating a duplicate task / comment / message
 * when a request timed out after the server had already saved it.
 *
 * Uses `crypto.randomUUID` / `crypto.getRandomValues` when the runtime has them; Hermes on
 * React Native 0.74 has neither by default, so it falls back to a time + Math.random v4-shaped id
 * (uniqueness, not secrecy, is what matters for an idempotency key).
 */
type CryptoLike = { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView>(a: T) => T };

export function newIdempotencyKey(random: () => number = Math.random, now: () => number = Date.now): string {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (random === Math.random && typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (random === Math.random && typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(random() * 256) & 0xff;
    // Mix the clock into the first 6 bytes so two devices with a weak PRNG seed still differ.
    let t = now();
    for (let i = 5; i >= 0; i -= 1) {
      bytes[i] = (bytes[i]! ^ (t & 0xff)) & 0xff;
      t = Math.floor(t / 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Request options carrying an idempotency key (or nothing when there is no key). */
export function idempotencyHeaders(key?: string | null): { headers?: Record<string, string> } {
  return key ? { headers: { 'Idempotency-Key': key } } : {};
}
