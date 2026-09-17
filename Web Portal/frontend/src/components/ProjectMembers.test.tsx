import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectMembers } from './ProjectMembers';

const members = [{ id: 'u1', name: 'Ada Lovelace', role: 'MEMBER' as const }];
const addable = [{ id: 'u2', name: 'Omar A', role: 'MEMBER' as const }];

describe('ProjectMembers', () => {
  it('lists members', () => {
    render(<ProjectMembers members={members} addableUsers={addable} canManage={false} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('hides management controls when the viewer cannot manage', () => {
    render(<ProjectMembers members={members} addableUsers={addable} canManage={false} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /remove Ada Lovelace/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/add a member/i)).not.toBeInTheDocument();
  });

  it('adds and removes members when allowed', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<ProjectMembers members={members} addableUsers={addable} canManage onAdd={onAdd} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: /remove Ada Lovelace/i }));
    expect(onRemove).toHaveBeenCalledWith('u1');
    await userEvent.selectOptions(screen.getByLabelText(/add a member/i), 'u2');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onAdd).toHaveBeenCalledWith('u2');
  });

  it('shows a manager badge and lets a manager be promoted/demoted', async () => {
    const onSetRole = vi.fn();
    render(
      <ProjectMembers
        members={[{ id: 'u1', name: 'Ada Lovelace', role: 'MANAGER' }, { id: 'u3', name: 'Bea', role: 'MEMBER' }]}
        addableUsers={[]}
        canManage
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onSetRole={onSetRole}
      />,
    );
    expect(screen.getByText('Manager')).toBeInTheDocument(); // the badge (exact)
    // demote Ada (currently manager) -> MEMBER
    await userEvent.click(screen.getByRole('button', { name: /make Ada Lovelace a member/i }));
    expect(onSetRole).toHaveBeenCalledWith('u1', 'MEMBER');
    // promote Bea -> MANAGER
    await userEvent.click(screen.getByRole('button', { name: /make Bea a manager/i }));
    expect(onSetRole).toHaveBeenCalledWith('u3', 'MANAGER');
  });
});
