import { describe, it, expect } from 'vitest';
import { fieldA11y, chipA11yState } from './a11y';

describe('fieldA11y (MOB-10)', () => {
  it('names a field after its visible label, marking required fields', () => {
    expect(fieldA11y({ label: 'Password', required: true })).toEqual({ accessibilityLabel: 'Password, required' });
    expect(fieldA11y({ label: 'Due date' })).toEqual({ accessibilityLabel: 'Due date' });
  });

  it('falls back to the placeholder for label-less fields', () => {
    expect(fieldA11y({ placeholder: 'Write a comment…' })).toEqual({ accessibilityLabel: 'Write a comment…' });
  });

  it('an explicit label wins', () => {
    expect(fieldA11y({ label: 'Tags', explicitLabel: 'Task tags' }).accessibilityLabel).toBe('Task tags');
  });

  it('reads the current error as the hint', () => {
    expect(fieldA11y({ label: 'Due date', error: '2026-02-31 is not a real date.' })).toEqual({
      accessibilityLabel: 'Due date',
      accessibilityHint: 'Error: 2026-02-31 is not a real date.',
    });
  });

  it('returns nothing when there is nothing to say', () => {
    expect(fieldA11y({})).toEqual({});
  });
});

describe('chipA11yState', () => {
  it('reports selection and disabled state', () => {
    expect(chipA11yState(true)).toEqual({ selected: true, disabled: false });
    expect(chipA11yState(false, true)).toEqual({ selected: false, disabled: true });
  });
});
