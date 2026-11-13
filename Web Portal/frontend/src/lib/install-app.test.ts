import { describe, it, expect, vi } from 'vitest';
import { createInstallApp, isAppleTouchDevice, NOT_NOW_FOR_MS, NOT_NOW_KEY, type InstallWorld } from './install-app';

const UA = {
  chromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iPad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  // iPad Safari asks for desktop sites by default: it says it is a Mac (only its touch screen gives it away).
  iPadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
};

interface PromptEvent {
  preventDefault: () => void;
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function world(over: { ua?: string; platform?: string; touch?: number; standalone?: boolean; iosStandalone?: boolean; store?: Map<string, string> | 'throws'; now?: number } = {}) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const modeListeners: (() => void)[] = [];
  let standalone = over.standalone ?? false;
  const store = over.store ?? new Map<string, string>();
  let now = over.now ?? Date.UTC(2026, 10, 13);
  const w: InstallWorld = {
    addEventListener: (type, fn) => void (listeners[type] ??= []).push(fn as (e: unknown) => void),
    displayModeStandalone: () => standalone,
    onDisplayModeChange: (fn) => void modeListeners.push(fn),
    navigator: { userAgent: over.ua ?? UA.chromeDesktop, platform: over.platform ?? 'Win32', maxTouchPoints: over.touch ?? 0, standalone: over.iosStandalone },
    storage: {
      getItem: (k) => {
        if (store === 'throws') throw new DOMException('denied', 'SecurityError');
        return store.get(k) ?? null;
      },
      setItem: (k, v) => {
        if (store === 'throws') throw new DOMException('denied', 'SecurityError');
        store.set(k, v);
      },
    },
    now: () => now,
  };
  const fire = (type: string, e: unknown = {}) => (listeners[type] ?? []).forEach((fn) => fn(e));
  const promptEvent = (outcome: 'accepted' | 'dismissed' = 'accepted'): PromptEvent => ({ preventDefault: vi.fn(), prompt: vi.fn(async () => undefined), userChoice: Promise.resolve({ outcome }) });
  return {
    w,
    store,
    fire,
    promptEvent,
    setStandalone: (v: boolean) => {
      standalone = v;
      modeListeners.forEach((fn) => fn());
    },
    later: (ms: number) => void (now += ms),
  };
}

describe('which devices are iPhones and iPads', () => {
  it('iPhone, iPad, and an iPad asking for desktop sites; never a Mac or another phone', () => {
    expect(isAppleTouchDevice({ userAgent: UA.iPhone, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: UA.iPad, platform: 'iPad', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: UA.iPadDesktop, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: UA.chromeAndroid, platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: UA.chromeDesktop, platform: 'Win32', maxTouchPoints: 10 })).toBe(false);
  });
});

describe('the install offer', () => {
  it('Chrome, Edge and Android: offered once the browser says the site can be installed (its own bar is held back)', () => {
    const t = world();
    const app = createInstallApp(t.w);
    app.start();
    expect(app.getSnapshot()).toMatchObject({ offer: 'none', showCard: false, showMenu: false });
    const e = t.promptEvent();
    t.fire('beforeinstallprompt', e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(app.getSnapshot()).toMatchObject({ offer: 'prompt', showCard: true, showMenu: true, installed: false });
  });

  it('Install opens the browser’s own install; once installed, nothing is offered any more', async () => {
    const t = world();
    const app = createInstallApp(t.w);
    app.start();
    const e = t.promptEvent('accepted');
    t.fire('beforeinstallprompt', e);
    expect(await app.install()).toBe('accepted');
    expect(e.prompt).toHaveBeenCalledTimes(1);
    t.fire('appinstalled');
    expect(app.getSnapshot()).toMatchObject({ offer: 'none', installed: true, showCard: false, showMenu: false });
  });

  it('closing the browser’s install window counts as Not now for the card (the menu item stays for later)', async () => {
    const t = world();
    const app = createInstallApp(t.w);
    app.start();
    t.fire('beforeinstallprompt', t.promptEvent('dismissed'));
    expect(await app.install()).toBe('dismissed');
    expect(app.getSnapshot().showCard).toBe(false);
    // The browser's offer is used up until it makes a new one (the next page load).
    expect(app.getSnapshot().showMenu).toBe(false);
    t.fire('beforeinstallprompt', t.promptEvent());
    expect(app.getSnapshot()).toMatchObject({ showMenu: true, showCard: false });
  });

  it('iPhone and iPad (desktop mode too): the Add to Home Screen guide, card and menu item alike', async () => {
    for (const d of [
      { ua: UA.iPhone, platform: 'iPhone', touch: 5 },
      { ua: UA.iPad, platform: 'iPad', touch: 5 },
      { ua: UA.iPadDesktop, platform: 'MacIntel', touch: 5 },
    ]) {
      const app = createInstallApp(world(d).w);
      app.start();
      expect(app.getSnapshot(), d.ua).toMatchObject({ offer: 'ios', showCard: true, showMenu: true, guideOpen: false });
      expect(await app.install()).toBe('guide');
      // One guide for the page (the menu that asked for it closes; the guide stays open until Done).
      expect(app.getSnapshot().guideOpen).toBe(true);
      app.closeGuide();
      expect(app.getSnapshot().guideOpen).toBe(false);
    }
  });

  it('hidden when running installed: display-mode standalone, or iOS’s navigator.standalone', () => {
    const chrome = world({ standalone: true });
    const a = createInstallApp(chrome.w);
    a.start();
    chrome.fire('beforeinstallprompt', chrome.promptEvent());
    expect(a.getSnapshot()).toMatchObject({ installed: true, offer: 'none', showCard: false, showMenu: false });
    const iphone = createInstallApp(world({ ua: UA.iPhone, platform: 'iPhone', touch: 5, iosStandalone: true }).w);
    iphone.start();
    expect(iphone.getSnapshot()).toMatchObject({ installed: true, offer: 'none', showMenu: false });
  });

  it('opened in its own window after installing (display mode changes): hidden at once', () => {
    const t = world();
    const app = createInstallApp(t.w);
    app.start();
    t.fire('beforeinstallprompt', t.promptEvent());
    const seen = vi.fn();
    app.subscribe(seen);
    t.setStandalone(true);
    expect(seen).toHaveBeenCalled();
    expect(app.getSnapshot().showMenu).toBe(false);
  });

  it('browsers that can’t install (Firefox, desktop Safari): nothing offered', () => {
    for (const d of [{ ua: UA.firefox }, { ua: UA.macSafari, platform: 'MacIntel', touch: 0 }]) {
      const app = createInstallApp(world(d).w);
      app.start();
      expect(app.getSnapshot(), d.ua).toMatchObject({ offer: 'none', showCard: false, showMenu: false });
    }
  });
});

describe('Not now', () => {
  it('hides the card on this device for 90 days; the menu item stays', () => {
    const t = world({ ua: UA.iPhone, platform: 'iPhone', touch: 5 });
    const app = createInstallApp(t.w);
    app.start();
    app.notNow();
    expect(t.store instanceof Map && t.store.get(NOT_NOW_KEY)).toBe(String(Date.UTC(2026, 10, 13)));
    expect(app.getSnapshot()).toMatchObject({ showCard: false, showMenu: true });
    // Another page load on this device, 89 days later: still hidden; after 90 days: offered again.
    t.later(NOT_NOW_FOR_MS - 24 * 3600_000);
    const next = createInstallApp(t.w);
    next.start();
    expect(next.getSnapshot().showCard).toBe(false);
    t.later(24 * 3600_000);
    const after = createInstallApp(t.w);
    after.start();
    expect(after.getSnapshot().showCard).toBe(true);
  });

  it('storage that throws (a private window, blocked site data): the page works, Not now lasts for this page', () => {
    const t = world({ ua: UA.iPhone, platform: 'iPhone', touch: 5, store: 'throws' });
    const app = createInstallApp(t.w);
    expect(() => app.start()).not.toThrow();
    expect(app.getSnapshot().showCard).toBe(true);
    expect(() => app.notNow()).not.toThrow();
    expect(app.getSnapshot()).toMatchObject({ showCard: false, showMenu: true });
  });

  it('a stored value that isn’t a time is ignored (the card shows)', () => {
    const t = world({ ua: UA.iPhone, platform: 'iPhone', touch: 5, store: new Map([[NOT_NOW_KEY, 'soon']]) });
    const app = createInstallApp(t.w);
    app.start();
    expect(app.getSnapshot().showCard).toBe(true);
  });
});

describe('the snapshot (for React)', () => {
  it('is the same object until something changes', () => {
    const t = world();
    const app = createInstallApp(t.w);
    app.start();
    const first = app.getSnapshot();
    expect(app.getSnapshot()).toBe(first);
    t.fire('beforeinstallprompt', t.promptEvent());
    expect(app.getSnapshot()).not.toBe(first);
  });
});
