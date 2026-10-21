/**
 * An id the app will open (3a review): what the server's ids look like — letters, digits, _ and -,
 * at most 64 characters (cuid and uuid ids). Checked where an id comes in from outside — a link, a
 * push — so `mico360://chat/..%2F..%2Fprojects%2Fp1` opens nothing; the API paths encode every id
 * as well (resources).
 */
const ID = /^[\w-]{1,64}$/;

export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}
