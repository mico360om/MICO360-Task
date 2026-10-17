import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichNoteView } from './RichNoteView';

describe('RichNoteView', () => {
  it('shows bold, italic, underline, highlight, a heading, lists and links as they were written', () => {
    const { container } = render(
      <RichNoteView html={'<h3>Site</h3><p>Pour the <strong>slab</strong> on <em>Monday</em>, <u>early</u>, <mark>no rain</mark>. See <a href="https://example.com/plan">the plan</a>.</p><ol><li><p>Book trucks</p></li></ol><ul><li><p>Pump</p></li></ul>'} />,
    );
    expect(screen.getByRole('heading', { name: 'Site' }).tagName).toBe('H3');
    expect(container.querySelector('strong')).toHaveTextContent('slab');
    expect(container.querySelector('em')).toHaveTextContent('Monday');
    expect(container.querySelector('u')).toHaveTextContent('early');
    expect(container.querySelector('mark')).toHaveTextContent('no rain');
    const link = screen.getByRole('link', { name: 'the plan' });
    expect(link).toHaveAttribute('href', 'https://example.com/plan');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(container.querySelector('ol li')).toHaveTextContent('Book trucks');
    expect(container.querySelector('ul li')).toHaveTextContent('Pump');
  });

  it('never shows scripts, pictures, handlers or unsafe links', () => {
    const { container } = render(<RichNoteView html={'<p onclick="alert(1)">Hi<script>alert(1)</script><img src=x onerror="alert(1)"> <a href="javascript:alert(1)">click</a></p>'} />);
    expect(container.querySelector('script, img, [onclick]')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('Hi click');
  });

  it('lets each paragraph take its own direction (Arabic beside English)', () => {
    const { container } = render(<RichNoteView html={'<p>مراجعة خطة السلامة</p><p>English line</p>'} />);
    expect([...container.querySelectorAll('p')].every((p) => p.getAttribute('dir') === 'auto')).toBe(true);
  });
});
