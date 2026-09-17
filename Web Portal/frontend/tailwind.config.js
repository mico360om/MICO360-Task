/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', ':root[data-theme="dark"]'],
  theme: {
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
        // Kanban / status categories
        cat: {
          backlog: 'rgb(var(--c-cat-backlog) / <alpha-value>)',
          todo: 'rgb(var(--c-cat-todo) / <alpha-value>)',
          progress: 'rgb(var(--c-cat-progress) / <alpha-value>)',
          blocked: 'rgb(var(--c-cat-blocked) / <alpha-value>)',
          review: 'rgb(var(--c-cat-review) / <alpha-value>)',
          done: 'rgb(var(--c-cat-done) / <alpha-value>)',
        },
      },
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
  plugins: [],
};
