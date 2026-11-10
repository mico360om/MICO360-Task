/**
 * 1.23.14 — was the page on screen? The Error log's time rules.
 *
 * The live Error log counted time a page spent where nothing could happen as "slow": a page opened in a
 * background tab "took" 3386 s to show, a frozen tab's 30-second bell request "took" 21 s fifteen times a
 * night, a sleeping laptop's requests all "took" the same 29.8 s. A page is away while it is hidden (a
 * background tab, a minimised window, a locked screen), frozen by the browser (freeze … resume), being
 * left (beforeunload, pagehide — also into the back-forward cache) or prerendered and not yet shown.
 *
 *  - `mark()` at a request's start and `awaySince(mark)` at its end: was the page away at any moment in
 *    between (an epoch counter that moves at every change, compared at both ends), or did the device
 *    sleep (its wall clock and the page's own monotonic clock drifted apart by over 2 s)?
 *  - `awayBetween(from, to)`: did a stretch of the page's timeline (a click's, a layout shift's) touch any
 *    time away?
 *  - `firstHiddenTime()`: web-vitals' rule for page-show times — the first moment the page was hidden
 *    (0: it started hidden; Infinity: not yet). Prerendering is not "hidden" until it is shown hidden.
 *
 * Nothing here throws at the page; it only listens.
 */

/** A moment of the page, taken at a request's start (opaque to the API client). */
export interface PageMark {
  epoch: number;
  away: boolean;
  mono: number;
  wall: number;
}

/** The wall clock and the page's own clock drifting apart by more than this during a request: the device slept. */
export const SLEEP_DRIFT_MS = 2000;
/** Stretches of time away kept (the oldest are dropped). */
const MAX_SPANS = 100;

export interface PageLifecycle {
  mark(): PageMark;
  awaySince(start: PageMark): boolean;
  awayBetween(from: number, to: number): boolean;
  firstHiddenTime(): number;
  /** A prerendered page's activation (0 otherwise): its page-show times count from there. */
  activationStart(): number;
  /** Restored from the back-forward cache at least once (its page-show times are not new). */
  restored(): boolean;
  stop(): void;
}

export interface PageLifecycleOptions {
  clock?: { mono: () => number; wall: () => number };
  activationStart?: () => number;
  /** The browser's own 'visibility-state' entries (from before this script ran), where it has them. */
  visibilityEntries?: () => { name: string; startTime: number }[];
}

type Doc = Document & { prerendering?: boolean };

function navigationActivationStart(win: Window): number {
  try {
    const nav = win.performance?.getEntriesByType?.('navigation')[0] as (PerformanceEntry & { activationStart?: number }) | undefined;
    return Math.max(0, Number(nav?.activationStart) || 0);
  } catch {
    return 0;
  }
}

function browserVisibilityEntries(win: Window): { name: string; startTime: number }[] {
  try {
    const PO = (win as Window & { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    if (!PO?.supportedEntryTypes?.includes('visibility-state')) return [];
    return win.performance.getEntriesByType('visibility-state').map((e) => ({ name: e.name, startTime: e.startTime }));
  } catch {
    return [];
  }
}

export function createPageLifecycle(win: Window, opts: PageLifecycleOptions = {}): PageLifecycle {
  const doc = win.document as Doc;
  const mono = opts.clock?.mono ?? (() => win.performance.now());
  const wall = opts.clock?.wall ?? (() => Date.now());
  const activation = opts.activationStart ?? (() => navigationActivationStart(win));
  let stopped = false;
  let frozen = false;
  let leaving = false;
  let restored = false;
  let epoch = 0;
  const hiddenNow = () => doc.visibilityState === 'hidden';
  const prerenderingNow = () => doc.prerendering === true;
  const awayNow = () => hiddenNow() || frozen || leaving || prerenderingNow();

  let away = awayNow();
  /** Stretches of time away on the page's timeline (end null: away now). */
  const spans: { start: number; end: number | null }[] = away ? [{ start: 0, end: null }] : [];
  let firstHidden = hiddenNow() && !prerenderingNow() ? 0 : Infinity;
  try {
    // What the browser saw before this script ran (a tab switched away and back while it loaded). Not
    // while prerendering, and only after a prerendered page's activation (web-vitals): before it, the page
    // was being prepared, not hidden from someone.
    let open: number | null = null;
    const activatedAt = prerenderingNow() ? Infinity : activation();
    const seenEntries = prerenderingNow() ? [] : (opts.visibilityEntries ?? (() => browserVisibilityEntries(win)))();
    for (const e of seenEntries.filter((x) => activatedAt <= 0 || x.startTime > activatedAt)) {
      if (e.name === 'hidden') {
        firstHidden = Math.min(firstHidden, e.startTime);
        if (open === null) open = e.startTime;
      } else if (e.name === 'visible' && open !== null) {
        if (!spans.some((s) => s.start <= open! && (s.end ?? Infinity) >= e.startTime)) spans.push({ start: open, end: e.startTime });
        open = null;
      }
    }
  } catch {
    // Without them: what this script sees from now on.
  }

  /** The page's state now: a change moves the epoch and opens or closes a stretch of time away. */
  function update(): void {
    if (stopped) return;
    const now = awayNow();
    if (now === away) return;
    away = now;
    epoch += 1;
    const t = mono();
    if (now) {
      spans.push({ start: t, end: null });
      if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
    } else {
      const last = spans[spans.length - 1];
      if (last && last.end === null) last.end = t;
    }
  }

  const safe = (fn: (e: Event) => void) => (e: Event) => {
    try {
      fn(e);
    } catch {
      // Listening can never be what breaks the page.
    }
  };
  const onVisibility = safe(() => {
    if (hiddenNow()) firstHidden = Math.min(firstHidden, mono());
    update();
  });
  const onPrerendered = safe(() => {
    // Shown at last — but in a background tab: it has always been hidden (web-vitals).
    if (hiddenNow()) firstHidden = 0;
    update();
  });
  const onFreeze = safe(() => {
    frozen = true;
    update();
  });
  const onResume = safe(() => {
    frozen = false;
    update();
  });
  const onLeave = safe(() => {
    leaving = true;
    update();
  });
  const onShow = safe((e) => {
    if ((e as PageTransitionEvent).persisted) restored = true;
    leaving = false;
    frozen = false;
    update();
  });
  // A cancelled "Leave site?" prompt: the person is back on the page.
  const onBack = safe(() => {
    if (!leaving) return;
    leaving = false;
    update();
  });

  doc.addEventListener('visibilitychange', onVisibility, true);
  doc.addEventListener('prerenderingchange', onPrerendered, true);
  doc.addEventListener('freeze', onFreeze, true);
  doc.addEventListener('resume', onResume, true);
  win.addEventListener('beforeunload', onLeave, true);
  win.addEventListener('pagehide', onLeave, true);
  win.addEventListener('pageshow', onShow, true);
  win.addEventListener('focus', onBack, true);
  doc.addEventListener('pointerdown', onBack, true);
  doc.addEventListener('keydown', onBack, true);

  return {
    mark() {
      update();
      return { epoch, away, mono: mono(), wall: wall() };
    },
    awaySince(start) {
      update();
      if (start.away || away || epoch !== start.epoch) return true;
      const drift = wall() - start.wall - (mono() - start.mono);
      return Math.abs(drift) > SLEEP_DRIFT_MS;
    },
    awayBetween(from, to) {
      update();
      // Strictly inside: a request that starts at the very moment the page came back (a coarse clock) is not away.
      return spans.some((s) => s.start < to && (s.end ?? Infinity) > from);
    },
    firstHiddenTime: () => firstHidden,
    activationStart: () => {
      try {
        return activation();
      } catch {
        return 0;
      }
    },
    restored: () => restored,
    stop() {
      stopped = true;
      doc.removeEventListener('visibilitychange', onVisibility, true);
      doc.removeEventListener('prerenderingchange', onPrerendered, true);
      doc.removeEventListener('freeze', onFreeze, true);
      doc.removeEventListener('resume', onResume, true);
      win.removeEventListener('beforeunload', onLeave, true);
      win.removeEventListener('pagehide', onLeave, true);
      win.removeEventListener('pageshow', onShow, true);
      win.removeEventListener('focus', onBack, true);
      doc.removeEventListener('pointerdown', onBack, true);
      doc.removeEventListener('keydown', onBack, true);
    },
  };
}
