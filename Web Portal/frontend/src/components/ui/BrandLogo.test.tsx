import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo } from './BrandLogo';

describe('BrandLogo', () => {
  it('has one picture per theme: the dark-lettered logo in the light theme, the white one in the dark', () => {
    render(<BrandLogo />);
    const [light, dark] = screen.getAllByRole('img', { name: 'MICO360' });
    expect(light).toHaveClass('dark:hidden');
    expect(dark).toHaveClass('hidden', 'dark:block');
    expect(light!.getAttribute('src')).not.toBe(dark!.getAttribute('src'));
  });

  it('reserves its space (width and height given), so nothing moves when it arrives', () => {
    render(<BrandLogo />);
    for (const img of screen.getAllByRole('img', { name: 'MICO360' })) {
      expect(img).toHaveAttribute('width');
      expect(img).toHaveAttribute('height');
    }
  });

  it('loads at once by default (above the fold), lazily only when asked', () => {
    const { unmount } = render(<BrandLogo />);
    expect(document.querySelector('img[loading="lazy"]')).toBeNull();
    unmount();
    render(<BrandLogo lazy className="h-9" />);
    expect(document.querySelectorAll('img[loading="lazy"]')).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'MICO360' })[0]).toHaveClass('h-9');
  });
});
