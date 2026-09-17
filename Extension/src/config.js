/** Default API/app URLs; overridable via chrome.storage so the extension can point at production. */
export const DEFAULTS = { apiBase: 'http://localhost:4000/api/v1', appBase: 'http://localhost:5173' };

/** Resolve the configured API/app bases, falling back to defaults for blank/missing values (T16.4/T16.6). */
export function resolveBases(stored = {}) {
  const pick = (v, d) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\/$/, '') : d);
  return {
    apiBase: pick(stored.apiBase, DEFAULTS.apiBase),
    appBase: pick(stored.appBase, DEFAULTS.appBase),
  };
}
