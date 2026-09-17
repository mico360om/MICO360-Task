import type { LabelHTMLAttributes, ReactNode } from 'react';

/**
 * Red asterisk marking a required field. Visual only (aria-hidden) — the required
 * semantic is conveyed to screen readers by `aria-required="true"` on the control,
 * so the field's accessible name stays clean.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 font-semibold text-danger">
      *
    </span>
  );
}

export interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  children: ReactNode;
}

/** Consistent form label; appends a red * when the field is required. */
export function FieldLabel({ required, children, className = '', ...rest }: FieldLabelProps) {
  return (
    <label {...rest} className={`text-sm font-medium text-ink ${className}`.trim()}>
      {children}
      {required ? <RequiredMark /> : null}
    </label>
  );
}

/** Consistent input/select/textarea class; adds a red ring/border in the error state. */
export function fieldClass(hasError?: boolean, extra = ''): string {
  const base =
    'rounded-lg border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors';
  const state = hasError
    ? 'border-danger ring-2 ring-danger/30 focus:border-danger'
    : 'border-line focus:border-brand focus:ring-2 focus:ring-brand/20';
  return `${base} ${state} ${extra}`.trim();
}

/** Inline validation message shown beneath a field (announced to screen readers). */
export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-0.5 text-xs font-medium text-danger">
      {children}
    </p>
  );
}
