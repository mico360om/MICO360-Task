import plugin from 'tailwindcss/plugin';

// 1.23.8 One colour scheme (src/lib/colour-scheme.ts, CSS variables in index.css): each token as a fill
// (bg-/border-/ring-/fill- utilities, e.g. `bg-status-progress`) with its soft tint (`bg-status-progress-soft`),
// and as words (`text-status-progress` reads the token's text tone, 4.5:1). Components use
// src/lib/colour-classes.ts rather than writing these themselves.
const scheme = (text) => {
  const tone = (name) => ({ DEFAULT: `rgb(var(--c-${name}${text ? '-text' : ''}) / <alpha-value>)`, soft: `rgb(var(--c-${name}-soft) / <alpha-value>)` });
  return {
    status: { backlog: tone('status-backlog'), todo: tone('status-todo'), progress: tone('status-progress'), blocked: tone('status-blocked'), review: tone('status-review'), done: tone('status-done') },
    prio: { urgent: tone('prio-urgent'), high: tone('prio-high'), normal: tone('prio-normal'), low: tone('prio-low') },
    overdue: tone('overdue'),
    soon: tone('soon'),
    health: { ok: tone('health-ok'), risk: tone('health-risk'), late: tone('health-late') },
  };
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', ':root[data-theme="dark"]'],
  theme: {
    // The usual widths (640 / 768 / 1024 / 1280 / 1536px at the default 16px text), in em so they
    // follow the reader's default text size: sizes here are rem, so with larger text the layout must
    // switch to its narrower form sooner — exactly what page zoom does. In px, a laptop set to
    // "very large" text kept the desktop layout with a third less room (cut and overlapping text).
    screens: { sm: '40em', md: '48em', lg: '64em', xl: '80em', '2xl': '96em' },
    extend: {
      // Colors are CSS variables (space-separated RGB) so the palette can be re-themed at
      // runtime (light/dark) without changing components. Light values live in index.css :root
      // and are identical to the original hex, so the light theme is unchanged.
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--c-brand) / <alpha-value>)',
          2: 'rgb(var(--c-brand-2) / <alpha-value>)',
          3: 'rgb(var(--c-brand-3) / <alpha-value>)',
          ink: 'rgb(var(--c-brand-ink) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          2: 'rgb(var(--c-ink-2) / <alpha-value>)',
          3: 'rgb(var(--c-ink-3) / <alpha-value>)',
        },
        line: { DEFAULT: 'rgb(var(--c-line) / <alpha-value>)', 2: 'rgb(var(--c-line-2) / <alpha-value>)' },
        surface: { DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)', 2: 'rgb(var(--c-surface-2) / <alpha-value>)' },
        ground: { DEFAULT: 'rgb(var(--c-ground) / <alpha-value>)', 2: 'rgb(var(--c-ground-2) / <alpha-value>)' },
        danger: { DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)', soft: 'rgb(var(--c-danger-soft) / <alpha-value>)' },
        success: { DEFAULT: 'rgb(var(--c-success) / <alpha-value>)', soft: 'rgb(var(--c-success-soft) / <alpha-value>)' },
        warning: { DEFAULT: 'rgb(var(--c-warning) / <alpha-value>)', soft: 'rgb(var(--c-warning-soft) / <alpha-value>)' },
        info: { DEFAULT: 'rgb(var(--c-info) / <alpha-value>)', soft: 'rgb(var(--c-info-soft) / <alpha-value>)' },
        // Meetings on the Timeline page.
        meeting: 'rgb(var(--c-meeting) / <alpha-value>)',
        // What a dialog, sheet or panel lays over the page behind it: the same dark wash in light and
        // dark mode (a tint of ink would be a light-grey wash in dark mode, where ink is near-white).
        scrim: 'rgb(0 0 0 / 0.5)',
        ...scheme(false),
      },
      // As text, the brand and status colours use their "text tone" so small labels reach 4.5:1 on white,
      // on the page ground and on their own soft tint; bg-/border-/ring- utilities keep the fill colour.
      textColor: {
        brand: {
          DEFAULT: 'rgb(var(--c-brand-text) / <alpha-value>)',
          2: 'rgb(var(--c-brand-2) / <alpha-value>)',
          3: 'rgb(var(--c-brand-3) / <alpha-value>)',
          ink: 'rgb(var(--c-brand-ink) / <alpha-value>)',
        },
        danger: { DEFAULT: 'rgb(var(--c-danger-text) / <alpha-value>)', soft: 'rgb(var(--c-danger-soft) / <alpha-value>)' },
        success: { DEFAULT: 'rgb(var(--c-success-text) / <alpha-value>)', soft: 'rgb(var(--c-success-soft) / <alpha-value>)' },
        warning: { DEFAULT: 'rgb(var(--c-warning-text) / <alpha-value>)', soft: 'rgb(var(--c-warning-soft) / <alpha-value>)' },
        info: { DEFAULT: 'rgb(var(--c-info-text) / <alpha-value>)', soft: 'rgb(var(--c-info-soft) / <alpha-value>)' },
        ...scheme(true),
      },
      // A row's text in compact (lib/density.ts): one step under text-sm, on a tighter line.
      fontSize: { row: ['13px', '18px'] },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        display: ['Archivo', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { tightish: '-0.01em' },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' },
      boxShadow: {
        soft: '0 1px 2px rgba(33,27,26,0.04), 0 1px 3px rgba(33,27,26,0.06)',
        card: '0 1px 2px rgba(33,27,26,0.04), 0 8px 24px -12px rgba(33,27,26,0.14)',
        lift: '0 6px 12px -6px rgba(33,27,26,0.12), 0 18px 40px -18px rgba(33,27,26,0.28)',
        brand: '0 8px 20px -8px rgba(139,30,30,0.5)',
        ring: '0 0 0 3px rgba(139,30,30,0.18)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #A83326 0%, #8B1E1E 55%, #5E1414 100%)',
        'brand-sheen': 'linear-gradient(135deg, #C7513F 0%, #8B1E1E 100%)',
        'ground-fade': 'radial-gradient(1200px 500px at 100% -10%, rgba(168,51,38,0.06), transparent 60%)',
      },
      transitionTimingFunction: {
        emphasized: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-in-up': {
          // End at `none` (not translateY(0)) so `fill-mode: both` doesn't leave a residual
          // transform on the page wrapper — a lingering transform creates a containing block that
          // breaks `position: fixed` descendants (drag overlay + modals offset from the viewport).
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'bar-grow': { '0%': { transform: 'scaleY(0)' }, '100%': { transform: 'scaleY(1)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease both',
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scale-in 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.6s linear infinite',
        float: 'float 6s ease-in-out infinite',
        'bar-grow': 'bar-grow 0.7s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [
    // `compact:` — Compact rows (1.23.0, lib/density.ts): only when the person chose compact
    // (<html data-density="compact">) AND from the md width with a mouse or trackpad, so phones and
    // touch screens always keep the comfortable sizes. Comfortable is untouched: without the attribute
    // these rules match nothing. (COMPACT_MEDIA in lib/density.ts is the same media.)
    plugin(({ addVariant }) => {
      addVariant('compact', '@media (min-width: 48em) and (pointer: fine) { :root[data-density="compact"] & }');
      // `detailed:` — Detailed rows (1.23.8, lib/density.ts): with <html data-density="detailed">, on every
      // screen (it shows more and never shrinks a target, so phones and touch screens get it too).
      addVariant('detailed', ':root[data-density="detailed"] &');
      // `rail:` — the side menu as its 64px icon rail (components/Sidebar): on a tablet (768–1023px) always,
      // and from 1024px when the person folded it (1.23.8, <html data-sidebar="collapsed">, lib/appearance.ts).
      addVariant('rail', ['@media (min-width: 48em) { @media not all and (min-width: 64em) { & } }', '@media (min-width: 64em) { :root[data-sidebar="collapsed"] & }']);
    }),
  ],
};
