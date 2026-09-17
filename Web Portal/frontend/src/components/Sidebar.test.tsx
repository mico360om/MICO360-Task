import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

function renderSidebar(isAdmin: boolean) {
  return render(
    <MemoryRouter>
      <Sidebar isAdmin={isAdmin} />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('shows the core navigation for every user', () => {
    renderSidebar(false);
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /kanban board/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /my tasks/i })).toBeInTheDocument();
  });

  it('hides admin-only items from employees', () => {
    renderSidebar(false);
    expect(screen.queryByRole('link', { name: /user management/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /audit logs/i })).not.toBeInTheDocument();
  });

  it('shows admin-only items to admins', () => {
    renderSidebar(true);
    expect(screen.getByRole('link', { name: /user management/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ai management/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /system settings/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /audit logs/i })).toBeInTheDocument();
  });
});
