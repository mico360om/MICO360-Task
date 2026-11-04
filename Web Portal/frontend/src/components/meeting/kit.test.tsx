import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShrunkSection } from './kit';

describe('ShrunkSection', () => {
  it('its one line is a paragraph never inside a span, with any extra beside it (1.23.0: List | Table)', () => {
    const { container, rerender } = render(<ShrunkSection id="agenda" title="Agenda" empty="No agenda" addLabel="Add a topic" onAdd={() => {}} />);
    expect(container.querySelector('span p')).toBeNull();
    rerender(<ShrunkSection id="agenda" title="Agenda" empty="No agenda" addLabel="Add a topic" onAdd={() => {}} extra={<button type="button">Table view</button>} />);
    expect(container.querySelector('span p')).toBeNull();
    expect(screen.getByRole('button', { name: 'Table view' })).toBeInTheDocument();
    expect(screen.getByText('No agenda')).toBeInTheDocument();
  });
});
