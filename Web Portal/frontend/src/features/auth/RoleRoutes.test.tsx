import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { ClientRoute, HomeRedirect, StaffRoute } from './RoleRoutes';
import { clientPathFor, isClientUser, landingPathFor, staffPathFor } from './client-routes';
import { useAuthStore } from '../../stores/auth-store';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ClientRoute />}>
          <Route path="/portal" element={<div>Portal home</div>} />
          <Route path="/portal/*" element={<Where />} />
        </Route>
        <Route element={<StaffRoute />}>
          <Route path="/dashboard" element={<div>Staff dashboard</div>} />
          <Route path="/projects/:id" element={<div>Staff project</div>} />
          <Route path="/meetings/:id" element={<div>Staff meeting</div>} />
          <Route path="/admin/users" element={<div>Staff admin</div>} />
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </MemoryRouter>,
  );
}

const signIn = (roles: string[]) =>
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles }, accessToken: 'at', refreshToken: 'rt' });

beforeEach(() => {
  useAuthStore.getState().logout('remote');
});

describe('isClient', () => {
  it('a client account has the CLIENT role (the store says so too)', () => {
    expect(isClientUser({ roles: ['CLIENT'] })).toBe(true);
    expect(isClientUser({ roles: ['EMPLOYEE'] })).toBe(false);
    expect(isClientUser({ roles: ['ADMIN'] })).toBe(false);
    expect(isClientUser(null)).toBe(false);
    signIn(['CLIENT']);
    expect(useAuthStore.getState().isClient()).toBe(true);
    signIn(['ADMIN']);
    expect(useAuthStore.getState().isClient()).toBe(false);
  });
});

describe('where a client or staff member goes', () => {
  it('a client stays on the portal, and an invitation link goes to the portal meeting', () => {
    expect(clientPathFor('/portal')).toBe('/portal');
    expect(clientPathFor('/portal/projects/p1/tasks/t1')).toBe('/portal/projects/p1/tasks/t1');
    expect(clientPathFor('/meetings/m1')).toBe('/portal/meetings/m1');
    expect(clientPathFor('/meetings/m1/')).toBe('/portal/meetings/m1');
    expect(clientPathFor('/dashboard')).toBe('/portal');
    expect(clientPathFor('/admin/users')).toBe('/portal');
    expect(clientPathFor('/portalx')).toBe('/portal');
    expect(clientPathFor('/meetings')).toBe('/portal');
  });

  it('staff never land on the portal', () => {
    expect(staffPathFor('/portal')).toBe('/dashboard');
    expect(staffPathFor('/portal/projects/p1')).toBe('/dashboard');
    expect(staffPathFor('/projects/p1?task=t1')).toBe('/projects/p1?task=t1');
  });

  it('after sign-in: a client lands on the portal (or the portal page asked for); staff on the page asked for', () => {
    expect(landingPathFor({ roles: ['CLIENT'] }, '/dashboard')).toBe('/portal');
    expect(landingPathFor({ roles: ['CLIENT'] }, '/portal/projects/p1/meetings')).toBe('/portal/projects/p1/meetings');
    expect(landingPathFor({ roles: ['CLIENT'] }, '/meetings/m9')).toBe('/portal/meetings/m9');
    expect(landingPathFor({ roles: ['ADMIN'] }, '/projects/p1')).toBe('/projects/p1');
    expect(landingPathFor({ roles: ['EMPLOYEE'] }, '/portal')).toBe('/dashboard');
  });
});

describe('ClientRoute / StaffRoute', () => {
  it('a client opening a staff page is sent to the portal', () => {
    signIn(['CLIENT']);
    renderAt('/dashboard');
    expect(screen.getByText('Portal home')).toBeInTheDocument();
    expect(screen.queryByText('Staff dashboard')).toBeNull();
  });

  it('a client opening an admin page or a staff project is sent to the portal', () => {
    signIn(['CLIENT']);
    const first = renderAt('/admin/users');
    expect(screen.getByText('Portal home')).toBeInTheDocument();
    first.unmount();
    renderAt('/projects/p1');
    expect(screen.getByText('Portal home')).toBeInTheDocument();
    expect(screen.queryByText('Staff project')).toBeNull();
  });

  it('a client opening an unknown address lands on the portal', () => {
    signIn(['CLIENT']);
    renderAt('/somewhere-new');
    expect(screen.getByText('Portal home')).toBeInTheDocument();
  });

  it('a client opening an invitation link (/meetings/:id) goes to the portal meeting', () => {
    signIn(['CLIENT']);
    renderAt('/meetings/m42');
    expect(screen.getByTestId('where')).toHaveTextContent('/portal/meetings/m42');
    expect(screen.queryByText('Staff meeting')).toBeNull();
  });

  it('staff opening the portal are sent to the dashboard', () => {
    signIn(['EMPLOYEE']);
    const first = renderAt('/portal');
    expect(screen.getByText('Staff dashboard')).toBeInTheDocument();
    first.unmount();
    signIn(['ADMIN']);
    renderAt('/portal/projects/p1/progress');
    expect(screen.getByText('Staff dashboard')).toBeInTheDocument();
  });

  it('staff keep their pages; an unknown address takes them to the dashboard', () => {
    signIn(['ADMIN']);
    const first = renderAt('/meetings/m1');
    expect(screen.getByText('Staff meeting')).toBeInTheDocument();
    first.unmount();
    renderAt('/nowhere');
    expect(screen.getByText('Staff dashboard')).toBeInTheDocument();
  });
});
