import { Children, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ShortcutAction } from '../../lib/shortcuts';
import { ShortcutHint, useShortcutHint } from '../shortcuts/ShortcutProvider';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** The keyboard shortcut this button stands for: added to its tooltip and `aria-keyshortcuts`. */
  shortcut?: ShortcutAction;
  /** Also show the shortcut's keys on the button (desktop only). */
  showShortcut?: boolean;
  children: ReactNode;
}

/** The button's own words, for its tooltip. */
const textOf = (children: ReactNode) =>
  Children.toArray(children)
    .filter((c): c is string | number => typeof c === 'string' || typeof c === 'number')
    .join('')
    .trim();

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-gradient text-white shadow-brand hover:shadow-lift hover:-translate-y-0.5 active:translate-y-0',
  secondary:
    'border border-line bg-surface text-ink hover:border-brand/30 hover:bg-ground hover:-translate-y-0.5 active:translate-y-0',
  ghost: 'text-ink-2 hover:bg-ground hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-95 hover:-translate-y-0.5 active:translate-y-0',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  onClick,
  shortcut,
  showShortcut = false,
  title,
  ...rest
}: ButtonProps) {
  const hint = useShortcutHint(shortcut);
  const label = title ?? (rest['aria-label'] as string | undefined) ?? textOf(children);
  return (
    <button
      {...rest}
      title={hint ? (label ? hint.title(label) : hint.keys) : title}
      aria-keyshortcuts={hint?.aria}
      data-variant={variant}
      aria-busy={loading}
      // A busy button is announced as unavailable and ignores presses, but is not natively disabled:
      // that would drop keyboard focus to the page, and someone saving from the keyboard would lose
      // their place in the dialog when the save comes back refused. A caller's own aria-disabled
      // (unavailable for now, but kept focusable) is kept too.
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      disabled={disabled}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={`group relative inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 ease-emphasized disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim()}
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
      ) : null}
      {children}
      {showShortcut && shortcut ? <ShortcutHint action={shortcut} /> : null}
    </button>
  );
}
