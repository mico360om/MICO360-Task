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
});
