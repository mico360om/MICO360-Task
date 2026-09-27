/**
 * Named mutual-exclusion locks shared by every extension context. In Chrome this is the Web Locks
 * API (`navigator.locks`), which is scoped to the extension's origin — so the app tab(s) and the
 * background service worker all queue on the same lock. Where it is missing, an in-process
 * fallback keeps callers in this JS realm serialized.
 */

const fallbackHeld = new Map(); // name -> tail promise of the in-process chain

async function fallbackRun(name, fn, { ifAvailable = false } = {}) {
  const prev = fallbackHeld.get(name);
  if (prev && ifAvailable) return { acquired: false };
  let release;
  const mine = new Promise((r) => { release = r; });
  const tail = (prev || Promise.resolve()).then(() => mine);
  fallbackHeld.set(name, tail);
  try {
    if (prev) await prev;
    return { acquired: true, value: await fn() };
  } finally {
    release();
    if (fallbackHeld.get(name) === tail) fallbackHeld.delete(name);
  }
}

/**
 * Run `fn` while holding the lock `name`. With `ifAvailable: true` the call does not wait: when the
 * lock is already held it returns `{ acquired: false }` without running `fn`. Otherwise it resolves
 * to `{ acquired: true, value }`.
 */
export async function withLock(name, fn, { ifAvailable = false, locks = globalThis.navigator?.locks } = {}) {
  if (locks && typeof locks.request === 'function') {
    let acquired = false;
    const value = await locks.request(name, ifAvailable ? { ifAvailable: true } : {}, async (lock) => {
      if (!lock) return undefined;
      acquired = true;
      return fn();
    });
    return acquired ? { acquired: true, value } : { acquired: false };
  }
  return fallbackRun(name, fn, { ifAvailable });
}
