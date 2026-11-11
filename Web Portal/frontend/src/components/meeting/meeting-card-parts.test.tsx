import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DateLeaf, People } from './meeting-card-parts';

describe('DateLeaf: the meeting day as a calendar leaf', () => {
  it('shows the weekday, the day and a three-letter month in the company time zone ("Sep", never "Sept")', () => {
    // 21:30 UTC on Tue 29 Sep is already Wed 30 Sep in Muscat.
    const { container } = render(<DateLeaf iso="2026-09-29T21:30:00.000Z" timeZone="Asia/Muscat" tone="upcoming" />);
    const parts = [...container.firstElementChild!.children].map((el) => el.textContent);
    expect(parts).toEqual(['Wed', '30', 'Sep']);
  });
});

describe('People: who is coming (avatar hotfix, owner 10 Nov)', () => {
  const faces = [
    { name: 'Khurram Mian', avatarUrl: '/uploads/avatars/km.png' },
    { name: 'guest@example.com', avatarUrl: null },
    { name: 'Omar Al Said', avatarUrl: null },
    { name: 'Sara Khan', avatarUrl: '/uploads/avatars/sara.png' },
  ];

  it('shows a photo for someone who has one and initials for the rest, three faces and "+N"', () => {
    const { container } = render(<People names={faces.map((f) => f.name)} faces={faces} count={5} />);
    expect(screen.getByAltText('Khurram Mian').getAttribute('src')).toMatch(/km\.png$/);
    expect(screen.getByLabelText('Omar Al Said')).toHaveTextContent('OA');
    expect(screen.getByLabelText('guest@example.com')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(1); // Sara is the fourth: "+2" instead
    expect(container).toHaveTextContent('+2');
    expect(container).toHaveTextContent('5 people');
  });

  it('an older server sends names only: initials, as before', () => {
    const { container } = render(<People names={['Khurram Mian', 'Omar Al Said']} count={2} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Khurram Mian')).toHaveTextContent('KM');
  });
});
