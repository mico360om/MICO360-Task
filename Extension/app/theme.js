const KEY = 'mico360.theme';

export function setThemeAttr(mode) {
  const r = document.documentElement;
  if (mode === 'light' || mode === 'dark') r.setAttribute('data-theme', mode);
  else r.removeAttribute('data-theme');
}

export async function getTheme(storage) {
  try {
    return (await storage.get(KEY))[KEY] || 'system';
  } catch {
    return 'system';
  }
}

export async function applyStoredTheme(storage) {
  setThemeAttr(await getTheme(storage));
}

export async function setTheme(storage, mode) {
  setThemeAttr(mode);
  try {
    await storage.set({ [KEY]: mode });
  } catch {
    /* ignore */
  }
}
