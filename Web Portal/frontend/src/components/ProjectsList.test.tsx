import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectsList } from './ProjectsList';
import type { ApiProject } from '../api/projects';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const project: ApiProject = {
  id: 'p1',
  code: 'MICO',
  name: 'MICO360 Platform',
  imageUrl: null,
  ownerId: null,
  description: null,
  clientName: 'Internal',
  status: 'ACTIVE',
  priority: 'HIGH',
  color: '#8B1E1E',
  startDate: null,
  targetDate: null,
  createdAt: '',
  updatedAt: '',
};

describe('ProjectsList', () => {
  it('renders projects with code, name and status', () => {
    wrap(<ProjectsList projects={[project]} />);
    expect(screen.getByText('MICO360 Platform')).toBeInTheDocument();
    expect(screen.getByText('MICO')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    wrap(<ProjectsList projects={[]} />);
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });

  it('offers an admin status control that reports changes', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const onChangeStatus = vi.fn();
    wrap(<ProjectsList projects={[project]} canManage onChangeStatus={onChangeStatus} />);
    await userEvent.click(screen.getByRole('button', { name: /status for MICO360 Platform/i }));
    await userEvent.click(screen.getByRole('option', { name: /on hold/i }));
    expect(onChangeStatus).toHaveBeenCalledWith('p1', 'ON_HOLD');
  });

  it('shows each project’s picture, else its icon on its colour, else its initials', () => {
    const { container } = wrap(
      <ProjectsList
        projects={[
          project,
          { ...project, id: 'p2', name: 'Rig Portal', icon: 'rocket', color: '#1E5A8B' },
          { ...project, id: 'p3', name: 'Logo Co', imageUrl: '/uploads/projects/logo.webp' },
        ]}
      />,
    );
    const cards = container.querySelectorAll('a[href^="/projects/"]');
    const avatarOf = (href: string) => [...cards].find((a) => a.getAttribute('href') === href)!.querySelector('[data-project-avatar]')!;
    expect(avatarOf('/projects/p1')).toHaveAttribute('data-project-avatar', 'initials'); // an existing project
    expect(avatarOf('/projects/p1')).toHaveTextContent('MP');
    expect(avatarOf('/projects/p2')).toHaveAttribute('data-project-avatar', 'icon');
    expect(avatarOf('/projects/p2')).toHaveStyle({ background: '#1E5A8B' });
    expect(avatarOf('/projects/p3')).toHaveAttribute('data-project-avatar', 'image');
    expect(avatarOf('/projects/p3').querySelector('img')?.getAttribute('src')).toContain('/uploads/projects/logo.webp');
  });

  it('gives an admin an Edit button on each card', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const onEdit = vi.fn();
    wrap(<ProjectsList projects={[project]} canManage onChangeStatus={() => {}} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit MICO360 Platform' }));
    expect(onEdit).toHaveBeenCalledWith(project);
  });
});
