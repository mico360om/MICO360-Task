/**
 * Test-only helpers (imported by *.test.js; not used by the extension at runtime).
 * `fakeStorage` mimics chrome.storage.{local,session}: get(key | keys[] | null), set(obj), remove(key | keys[]).
 */
export function fakeStorage(init = {}, { failSet } = {}) {
  const data = { ...init };
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      const ks = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of ks) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) {
      if (failSet && failSet(obj, data)) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(data, obj);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

/** Minimal fetch Response stand-in. */
export function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** An unsigned JWT-shaped token with the given `sub` (the extension never verifies signatures). */
export function fakeJwt(sub, extra = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, ...extra })}.sig`;
}
