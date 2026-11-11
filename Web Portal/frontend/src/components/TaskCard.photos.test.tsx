import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskCard, type TaskCardTask } from './TaskCard';

// Owner, 10 Nov (live Kanban screenshot): "Icon was not showing, fix it." A card showed "KM" although
// the person has a profile photo; the board's people strip showed it. A card's faces are the photos now.
const task: TaskCardTask = {
  key: 'MICO-7',
  title: 'Pour the level 5 slab',
  priority: 'NORMAL',
  progress: 10,
  assignees: [
    { id: 'u1', name: 'Khurram Mian', avatarUrl: '/uploads/avatars/km.png' },
    { id: 'u2', name: 'Omar Al Said', avatarUrl: null },
  ],
};

const card = () => screen.getByRole('button', { name: /MICO-7/ });

describe('a board card’s faces (avatar hotfix, owner 10 Nov)', () => {
  it('shows the photo of an assignee who has one', () => {
    render(<TaskCard task={task} timeZone="Asia/Muscat" />);
    const img = card().querySelector('img[alt="Khurram Mian"]');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/\/uploads\/avatars\/km\.png$/);
  });

  it('shows the initials of an assignee without a photo', () => {
    render(<TaskCard task={task} timeZone="Asia/Muscat" />);
    expect(screen.getByLabelText('Omar Al Said')).toHaveTextContent(/^OA$/);
    expect(card().querySelector('img[alt="Omar Al Said"]')).toBeNull();
  });

  it('falls back to the initials when a photo can’t be loaded', () => {
    render(<TaskCard task={task} timeZone="Asia/Muscat" />);
    fireEvent.error(card().querySelector('img[alt="Khurram Mian"]')!);
    expect(card().querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Khurram Mian')).toHaveTextContent(/^KM$/);
  });

  it('a single assignee’s name and photo both show', () => {
    render(<TaskCard task={{ ...task, assignees: [task.assignees[0]!] }} timeZone="Asia/Muscat" />);
    expect(card()).toHaveTextContent('Khurram Mian');
    expect(card().querySelector('img[alt="Khurram Mian"]')).not.toBeNull();
  });
});
