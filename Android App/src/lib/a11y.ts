/**
 * Screen-reader helpers (MOB-10). Pure so the wording is unit-tested and consistent everywhere.
 */

/**
 * Accessible name + hint for a text field: the visible label (or the placeholder when there is no
 * label), "required" when it is, and the current error as the hint so TalkBack reads it with the
 * field.
 */
export function fieldA11y(opts: {
  label?: string;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  explicitLabel?: string;
}): { accessibilityLabel?: string; accessibilityHint?: string } {
  const base = (opts.explicitLabel ?? opts.label ?? opts.placeholder ?? '').trim();
  const name = base ? `${base}${opts.required ? ', required' : ''}` : undefined;
  const hint = opts.error ? `Error: ${opts.error}` : undefined;
  return { ...(name ? { accessibilityLabel: name } : {}), ...(hint ? { accessibilityHint: hint } : {}) };
}

/** Accessibility state for a selectable chip (priority, status, scope, column…). */
export function chipA11yState(selected: boolean, disabled = false): { selected: boolean; disabled: boolean } {
  return { selected, disabled };
}
