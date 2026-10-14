import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectAvatar } from './ProjectAvatar';

const base = { name: 'Rig Inspection', color: '#1E5A8B', icon: null, imageUrl: null };

describe('ProjectAvatar — one look for a project everywhere', () => {
  it('shows the uploaded image, and the icon or initials if the image can’t load', () => {
    const { container } = render(<ProjectAvatar project={{ ...base, icon: 'rocket', imageUrl: '/uploads/logo.webp' }} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/\/uploads\/logo\.webp$/);
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull(); // the rocket
  });

  it('shows the chosen icon on the chosen colour, else the initials', () => {
    const { container, rerender } = render(<ProjectAvatar project={{ ...base, icon: 'rocket' }} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.background).toMatch(/30, 90, 139|1e5a8b/i);
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<ProjectAvatar project={base} />);
    expect(screen.getByText('RI')).toBeInTheDocument();
  });

  it('is decorative unless told its name, and comes in fixed sizes', () => {
    const { container, rerender } = render(<ProjectAvatar project={base} size="xs" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('h-5', 'w-5');
    rerender(<ProjectAvatar project={base} size="xl" label />);
    expect(screen.getByRole('img', { name: 'Rig Inspection' })).toHaveClass('h-16', 'w-16');
  });

  it('shows a picture still being chosen (a local preview) as it is', () => {
    const { container } = render(<ProjectAvatar project={{ ...base, imageUrl: 'blob:http://x/123' }} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('blob:http://x/123');
  });
});
