import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditUserModal } from './EditUserModal';
import { useAuthStore } from '../stores/auth-store';
import { apiCompany, apiUser, companyServer, type ListedUser } from '../test/company-server';
import { windowWidth } from '../test/window-width';

const alpha = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA' });
const beta = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA' });
const gamma = apiCompany({ id: 'cg', name: 'Gamma Co', code: 'GAMMA', status: 'ARCHIVED', archivedAt: '2026-10-30T08:00:00.000Z' });
const ref = (c: { id: string; name: string; code: string }) => ({ id: c.id, name: c.name, code: c.code });
const sam = apiUser({ id: 'u-sam', username: 'sam', firstName: 'Sam', lastName: 'Shared', companies: [ref(alpha), ref(beta)], primaryCompanyId: 'cb' });

const onClose = vi.fn();
function open(user: ListedUser) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditUserModal user={user} onClose={onClose} />
    </QueryClientProvider>,
  );
}
const save = () => userEvent.click(screen.getByRole('button', { name: /save changes/i }));

beforeEach(() => {
  onClose.mockReset();
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe('EditUserModal: companies', () => {
  it('one company: no company fields, and Save sends none', async () => {
    const one = apiUser({ ...sam, companies: [ref(alpha)], primaryCompanyId: 'ca' });
    const server = companyServer({ companies: [alpha] });
    open(one);
    await waitFor(() => expect(server.gets('/me/companies')).toHaveLength(1));
    expect(screen.queryByText('Companies')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Primary company' })).toBeNull();
    await save();
    await waitFor(() => expect(server.requests('PUT', '/users/u-sam')).toHaveLength(1));
    expect(server.lastBody('PUT', '/users/u-sam')).not.toHaveProperty('companyIds');
  });

  it('two companies: theirs are ticked and their primary chosen; a change is sent', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    open(sam);
    expect(await screen.findByRole('checkbox', { name: 'Alpha Co' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beta Co' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Primary company' })).toHaveValue('cb');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Beta Co' }));
    expect(screen.getByRole('combobox', { name: 'Primary company' })).toHaveValue('ca');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/u-sam')).toMatchObject({ firstName: 'Sam', companyIds: ['ca'], primaryCompanyId: 'ca' });
  });

  it('only the primary changed: both are sent', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    open(sam);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Primary company' }), 'ca');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/u-sam')).toMatchObject({ companyIds: ['ca', 'cb'], primaryCompanyId: 'ca' });
  });

  it('companies left as they were are not sent (a name change never touches them)', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    open(sam);
    await screen.findByRole('checkbox', { name: 'Alpha Co' });
    await userEvent.type(screen.getByLabelText(/first name/i), 'my');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = server.lastBody('PUT', '/users/u-sam') as Record<string, unknown>;
    expect(body.firstName).toBe('Sammy');
    expect(body).not.toHaveProperty('companyIds');
    expect(body).not.toHaveProperty('primaryCompanyId');
  });

  it('someone with 2+ companies shows them even when only one company is still active', async () => {
    companyServer({ companies: [alpha, apiCompany({ ...beta, status: 'ARCHIVED', archivedAt: '2026-10-30T08:00:00.000Z' })] });
    open(sam);
    expect(await screen.findByRole('checkbox', { name: 'Alpha Co' })).toBeChecked();
    const archived = screen.getByRole('checkbox', { name: 'Beta Co (archived)' });
    expect(archived).toBeChecked();
    // An archived company they still have can be taken away, not given.
    await userEvent.click(archived);
    expect(screen.queryByRole('checkbox', { name: 'Beta Co (archived)' })).toBeNull();
  });

  it('archived companies they don’t have aren’t offered', async () => {
    companyServer({ companies: [alpha, beta, gamma] });
    open(sam);
    await screen.findByRole('checkbox', { name: 'Alpha Co' });
    const group = screen.getByRole('group', { name: 'Companies' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('the server’s refusal is shown (they must keep a company)', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    server.refuseNext(409, 'LAST_COMPANY', 'Sam Shared must keep at least one company. Add another company first.', { method: 'PUT', path: /^\/users\/u-sam$/ });
    open(sam);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha Co' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Beta Co' }));
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sam Shared must keep at least one company. Add another company first.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on your own account the roles are locked, your companies are not', async () => {
    const me = apiUser({ ...sam, id: 'me', username: 'admin', roles: ['ADMIN'] });
    const server = companyServer({ companies: [alpha, beta] });
    open(me);
    expect(screen.getByLabelText('Administrator')).toBeDisabled();
    const beta_ = await screen.findByRole('checkbox', { name: 'Beta Co' });
    expect(beta_).toBeEnabled();
    await userEvent.click(beta_);
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/me')).toMatchObject({ companyIds: ['ca'], primaryCompanyId: 'ca' });
    expect(server.lastBody('PUT', '/users/me')).not.toHaveProperty('roleNames');
  });
});

describe('EditUserModal: a big form (1.22)', () => {
  it('960px from 1024px: the profile and password on the left, companies and access on the right; Close and Save stay in view', async () => {
    windowWidth(1280);
    companyServer({ companies: [alpha, beta] });
    open(sam);
    const companies = await screen.findByRole('group', { name: 'Companies' });
    const dialog = screen.getByRole('dialog', { name: 'Edit sam' });
    expect(dialog.className).toMatch(/lg:max-w-\[60rem\]/);
    const profile = dialog.querySelector<HTMLElement>('[data-form-column="profile"]')!;
    const access = dialog.querySelector<HTMLElement>('[data-form-column="access"]')!;
    expect(profile.parentElement!.className).toMatch(/grid-cols-/);
    for (const field of [/first name/i, /username/i, /^email/i, /new password/i]) expect(profile).toContainElement(screen.getByLabelText(field));
    expect(access).toContainElement(companies);
    expect(access).toContainElement(screen.getByLabelText('Account status'));
    expect(access).toContainElement(screen.getByLabelText('Administrator'));
    const scroller = dialog.querySelector('.overflow-y-auto')!;
    expect(scroller.contains(screen.getByRole('button', { name: /save changes/i }))).toBe(false);
    const close = screen.getAllByRole('button', { name: 'Close' });
    expect(close).toHaveLength(2); // the ✕ in the header and Close beside Save
    expect(scroller.contains(close[1]!)).toBe(false);
  });

  it('below 1024px: one column — profile, companies, access, then the password', async () => {
    windowWidth(800);
    companyServer({ companies: [alpha, beta] });
    open(sam);
    const companies = await screen.findByRole('group', { name: 'Companies' });
    expect(screen.getByRole('dialog', { name: 'Edit sam' }).querySelector('[data-form-column]')).toBeNull();
    const order = [screen.getByLabelText(/^email/i), companies, screen.getByLabelText('Account status'), screen.getByLabelText(/new password/i)];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Enter in New password resets it (not the profile)', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    open(sam);
    await screen.findByRole('group', { name: 'Companies' });
    await userEvent.type(screen.getByLabelText(/new password/i), 'Newpass123{Enter}');
    await waitFor(() => expect(server.requests('POST', '/users/u-sam/password')).toHaveLength(1));
    expect(server.requests('PUT', '/users/u-sam')).toHaveLength(0);
  });
});
