import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows up to two initials from a full name', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('builds the initials from letters only, so a name with brackets doesn’t show a bracket', () => {
    render(<Avatar name="Mohammed (OXY)" />);
    expect(screen.getByLabelText('Mohammed (OXY)')).toHaveTextContent(/^MO$/);
  });

  it('exposes the full name as an accessible title', () => {
    render(<Avatar name="omar" />);
    expect(screen.getByTitle('omar')).toBeInTheDocument();
  });

  it('puts the initials on a solid backing: overlapped avatars never show each other’s letters through the tint', () => {
    render(<Avatar name="Aisha Khan" />);
    const face = screen.getByLabelText('Aisha Khan');
    // The card's colour underneath, the brand tint on top of it: the same look on a card, but opaque.
    expect(face).toHaveClass('bg-surface');
    expect(face.className).toMatch(/linear-gradient\(rgb\(var\(--c-brand\)\/0\.1\)/);
    expect(face.className).not.toMatch(/(^|\s)bg-brand\/10(\s|$)/);
  });

  it('shows the person’s photo when they have one (avatar hotfix, owner 10 Nov)', () => {
    render(<Avatar name="Khurram Mian" src="/uploads/avatars/km.png" />);
    const img = screen.getByAltText('Khurram Mian');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/\/uploads\/avatars\/km\.png$/);
    expect(screen.queryByText('KM')).toBeNull();
  });

  it('falls back to the initials when the photo can’t be loaded, and tries a new photo again', () => {
    const { rerender } = render(<Avatar name="Khurram Mian" src="/uploads/avatars/gone.png" />);
    fireEvent.error(screen.getByAltText('Khurram Mian'));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Khurram Mian')).toHaveTextContent(/^KM$/);
    rerender(<Avatar name="Khurram Mian" src="/uploads/avatars/new.png" />);
    expect(screen.getByAltText('Khurram Mian').getAttribute('src')).toMatch(/new\.png$/);
  });

  it('loads the photo’s small face copy, then the photo itself if the copy fails, then the initials (avatar thumbnails)', () => {
    const key = '0b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.jpg';
    render(<Avatar name="Khurram Mian" src={`/uploads/${key}`} />);
    expect(screen.getByAltText('Khurram Mian').getAttribute('src')).toMatch(new RegExp(`/uploads/faces/${key.replace(/\./g, '\\.')}\\.webp$`));
    fireEvent.error(screen.getByAltText('Khurram Mian'));
    expect(screen.getByAltText('Khurram Mian').getAttribute('src')).toMatch(new RegExp(`/uploads/${key.replace(/\./g, '\\.')}$`));
    fireEvent.error(screen.getByAltText('Khurram Mian'));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Khurram Mian')).toHaveTextContent('KM');
  });

  it('loads the photo lazily and off the main thread (faces fill long lists)', () => {
    render(<Avatar name="Khurram Mian" src="/uploads/avatars/km.png" />);
    expect(screen.getByAltText('Khurram Mian')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByAltText('Khurram Mian')).toHaveAttribute('decoding', 'async');
  });

  it('a face beside the written name is decorative: screen readers hear the name once', () => {
    const { container } = render(
      <>
        <Avatar name="Khurram Mian" src="/uploads/avatars/km.png" decorative />
        <Avatar name="Omar Al Said" decorative />
      </>,
    );
    const [img, initials] = [container.querySelector('img')!, container.querySelector('span')!];
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
    expect(initials).toHaveAttribute('aria-hidden', 'true');
    expect(initials).not.toHaveAttribute('aria-label');
    expect(initials).toHaveTextContent('OA');
  });

  it('with no photo (null, empty or missing) it shows the initials', () => {
    render(
      <>
        <Avatar name="Ada Lovelace" src={null} />
        <Avatar name="Bo Diddley" src="" />
        <Avatar name="Cy Twombly" />
      </>,
    );
    expect(screen.getByLabelText('Ada Lovelace')).toHaveTextContent('AL');
    expect(screen.getByLabelText('Bo Diddley')).toHaveTextContent('BD');
    expect(screen.getByLabelText('Cy Twombly')).toHaveTextContent('CT');
    expect(document.querySelector('img')).toBeNull();
  });

  it('a face in a row is 24px, and 20px in compact (1.23.0); elsewhere it never changes', () => {
    render(
      <>
        <Avatar name="Ada Lovelace" size="sm" dense />
        <Avatar name="Bo Diddley" size="sm" />
        <Avatar name="Cy Twombly" size="sm" dense src="/uploads/cy.png" />
      </>,
    );
    expect(screen.getByLabelText('Ada Lovelace')).toHaveClass('h-6', 'w-6', 'compact:h-5', 'compact:w-5');
    expect(screen.getByLabelText('Bo Diddley').className).not.toMatch(/compact:/);
    expect(screen.getByAltText('Cy Twombly')).toHaveClass('h-6', 'w-6', 'compact:h-5', 'compact:w-5');
  });
});
