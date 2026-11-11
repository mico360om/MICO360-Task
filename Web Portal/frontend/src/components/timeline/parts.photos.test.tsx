import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Initials } from './parts';

// Avatar hotfix (owner, 10 Nov): the timeline's task faces show the photo; initials without one.
describe('the timeline’s task faces', () => {
  it('a photo for someone with one, initials for someone without; names on hover', () => {
    const { container } = render(<Initials people={[{ id: 'u1', name: 'Khurram Mian', avatarUrl: '/uploads/avatars/km.png' }, { id: 'u2', name: 'Omar Al Said', avatarUrl: null }]} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/km\.png$/);
    expect(container).toHaveTextContent('OA');
    expect(container.firstElementChild).toHaveAttribute('title', 'Khurram Mian, Omar Al Said');
  });

  it('a photo that doesn’t load becomes the initials', () => {
    const { container } = render(<Initials people={[{ id: 'u1', name: 'Khurram Mian', avatarUrl: '/uploads/avatars/gone.png' }]} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('KM');
  });
});
