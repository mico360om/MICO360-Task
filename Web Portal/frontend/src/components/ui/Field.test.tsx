import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldLabel, FieldError, fieldClass, RequiredMark } from './Field';

describe('Field primitives', () => {
  it('FieldLabel shows a red asterisk for required fields (kept out of the accessible name)', () => {
    render(<FieldLabel htmlFor="x" required>Email</FieldLabel>);
    const label = screen.getByText('Email').closest('label')!;
    expect(label.textContent).toContain('*'); // visible red asterisk
    // The asterisk is aria-hidden, so the label's accessible name is just "Email".
    expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe('*');
  });

  it('FieldLabel omits the asterisk for optional fields', () => {
    render(<FieldLabel htmlFor="x">Notes</FieldLabel>);
    expect(screen.getByText('Notes').closest('label')!.textContent).not.toContain('*');
  });

  it('RequiredMark renders the asterisk', () => {
    render(<RequiredMark />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('fieldClass adds a danger ring only in the error state', () => {
    expect(fieldClass(true)).toMatch(/border-danger/);
    expect(fieldClass(false)).not.toMatch(/border-danger/);
    expect(fieldClass(false)).toMatch(/border-line/);
  });

  it('FieldError renders an alert with the message, or nothing when empty', () => {
    const { rerender } = render(<FieldError>Required.</FieldError>);
    expect(screen.getByRole('alert')).toHaveTextContent('Required.');
    rerender(<FieldError>{undefined}</FieldError>);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
