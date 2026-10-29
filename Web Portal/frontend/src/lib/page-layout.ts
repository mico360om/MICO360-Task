/**
 * How the app shell lays out a page. Every page's content (and the top bar and footer with it) is
 * 95% of the space beside the menu, at most 105rem (1680px) wide and centred: on a big monitor
 * lines and cards stay a readable size instead of stretching to 2,400px.
 *
 * THE OPT-OUT: pages built around a wide grid keep the full width. Add a page here when it is a
 * board, a time grid or a full-height workspace that is better with every pixel.
 */
export const FULL_WIDTH_PAGES = ['/board', '/calendar', '/timeline', '/workload', '/chat', '/mico-ai'] as const;

/**
 * Pages sized to the window: their own height already leaves room for the footer under them
 * (`.chat-frame`, `.page-fill` in index.css). Every other page is at least a window tall, so the
 * footer waits below the fold instead of being shoved down as the page's content arrives.
 */
export const WINDOW_FIT_PAGES = ['/chat', '/mico-ai', '/calendar'] as const;

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function pageLayout(pathname: string): { wide: boolean; fitsWindow: boolean } {
  return {
    wide: FULL_WIDTH_PAGES.some((base) => under(pathname, base)),
    fitsWindow: WINDOW_FIT_PAGES.some((base) => under(pathname, base)),
  };
}

/** The content frame: the shell's top bar, page and footer all use it, so their edges line up. */
export function pageFrameClass(wide: boolean): string {
  return wide ? 'mx-auto w-[95%]' : 'mx-auto w-[95%] max-w-[105rem]';
}
