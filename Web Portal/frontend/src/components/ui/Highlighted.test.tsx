import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Highlighted } from './Highlighted';

describe('Highlighted — words found by a search, marked in the text', () => {
  it('marks the ranges the server gave', () => {
    const { container } = render(<p><Highlighted text="Check the scaffold permit" ranges={[{ start: 10, end: 15 }, { start: 19, end: 25 }]} /></p>);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['scaff', 'permit']);
    expect(container.textContent).toBe('Check the scaffold permit');
  });

  it('shows text as text, never as markup', () => {
    const { container } = render(<p><Highlighted text="<b>bold</b> <img src=x onerror=alert(1)>" ranges={[{ start: 3, end: 7 }]} /></p>);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<b>bold</b> <img src=x onerror=alert(1)>');
    expect(container.querySelector('mark')?.textContent).toBe('bold');
  });

  it('with no ranges, plain text', () => {
    const { container } = render(<p><Highlighted text="Plain" /></p>);
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('Plain');
  });
});
