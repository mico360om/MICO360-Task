import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditUserModal } from './EditUserModal';
import { useAuthStore } from '../stores/auth-store';
import { apiCompany, apiUser, companyServer, type ListedUser } from '../test/company-server';
import { windowWidth } from '../test/window-width';
import { MyProjectsSettings } from './settings/MyProjectsSettings';

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

// 1.22 review I2: a typed new password is never silently lost by Save changes.
describe('EditUserModal: Reset password is its own form (1.22 review)', () => {
  for (const width of [1280, 800]) {
    it(`${width}px: Reset password has its own form and Reset button, outside the profile form`, async () => {
      windowWidth(width);
      companyServer({ companies: [alpha, beta] });
      open(sam);
      await screen.findByRole('group', { name: 'Companies' });
      const box = screen.getByLabelText(/new password/i) as HTMLInputElement;
      const profileForm = (screen.getByLabelText(/first name/i) as HTMLInputElement).form;
      expect(profileForm).not.toBeNull();
      expect(box.form).not.toBeNull();
      expect(box.form).not.toBe(profileForm);
      expect(profileForm!.contains(box.form)).toBe(false);
      const reset = screen.getByRole('button', { name: /^reset$/i }) as HTMLButtonElement;
      expect(reset.type).toBe('submit');
      expect(reset.form).toBe(box.form);
      expect((screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement).form).toBe(profileForm);
      expect(box).toHaveAttribute('autocomplete', 'new-password');
    });

    it(`${width}px: Save changes with a new password typed but not reset keeps the dialog open and says so on the field`, async () => {
      windowWidth(width);
      const server = companyServer({ companies: [alpha, beta] });
      open(sam);
      await screen.findByRole('group', { name: 'Companies' });
      const box = screen.getByLabelText(/new password/i);
      await userEvent.type(box, 'Newpass123');
      await save();
      expect(await screen.findByText(/press reset to set it, or clear this box/i)).toBeInTheDocument();
      expect(box).toHaveAccessibleDescription(/press reset to set it, or clear this box/i);
      expect(box).toHaveFocus();
      expect(onClose).not.toHaveBeenCalled();
      expect(server.requests('PUT', '/users/u-sam')).toHaveLength(0);
      expect(server.requests('POST', '/users/u-sam/password')).toHaveLength(0);
      // Reset sets it; then Save changes saves the profile and closes.
      await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));
      await waitFor(() => expect(server.requests('POST', '/users/u-sam/password')).toHaveLength(1));
      await save();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(server.requests('PUT', '/users/u-sam')).toHaveLength(1);
    });
  }

  it('a cleared box no longer holds Save changes back', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    open(sam);
    await screen.findByRole('group', { name: 'Companies' });
    await userEvent.type(screen.getByLabelText(/new password/i), 'Newpass123');
    await save();
    await screen.findByText(/press reset to set it, or clear this box/i);
    await userEvent.clear(screen.getByLabelText(/new password/i));
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.requests('PUT', '/users/u-sam')).toHaveLength(1);
  });
});

// 1.22 review I3: Enter in "Search companies" filters; it never submits the form.
describe('EditUserModal: Search companies (1.22 review)', () => {
  it('Enter in Search companies filters the list and doesn’t save', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => apiCompany({ id: `c${i}`, name: `Company ${'ABCDEFG'[i]}`, code: `C${i}` }));
    const server = companyServer({ companies: seven });
    open(apiUser({ ...sam, companies: [ref(seven[0]!), ref(seven[1]!)], primaryCompanyId: 'c0' }));
    const search = await screen.findByRole('searchbox', { name: /search companies/i });
    await userEvent.type(search, 'Company C{Enter}');
    expect(screen.getByRole('checkbox', { name: 'Company C' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Company D' })).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.requests('PUT', '/users/u-sam')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EditUserModal: “Show my projects only” (1.22.3)', () => {
  const boss = apiUser({ id: 'u-boss', username: 'boss', firstName: 'Bina', lastName: 'Boss', roles: ['ADMIN'] });
  const mineSwitch = () => within(screen.getByRole('dialog')).getByRole('switch', { name: 'Show my projects only' });

  it('another administrator: the switch shows their saved state, says “they”, and a change is saved', async () => {
    const server = companyServer({ companies: [alpha] });
    open(boss);
    const sw = mineSwitch();
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription('Lists everywhere show only the projects they own, manage or are on the team of. They can still open any project by its link.');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/u-boss')).toMatchObject({ firstName: 'Bina', myProjectsOnly: true });
  });

  it('saved on: shown on, and turned off is sent as off', async () => {
    const server = companyServer({ companies: [alpha] });
    open({ ...boss, myProjectsOnly: true });
    expect(mineSwitch()).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(mineSwitch());
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/u-boss')).toMatchObject({ myProjectsOnly: false });
  });

  it('left as it was, it isn’t sent (a name change never touches it)', async () => {
    const server = companyServer({ companies: [alpha] });
    open({ ...boss, myProjectsOnly: true });
    await userEvent.type(screen.getByLabelText(/first name/i), 'h');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/u-boss')).not.toHaveProperty('myProjectsOnly');
  });

  it('an employee has no switch; ticking Administrator brings it, and both are saved together', async () => {
    const server = companyServer({ companies: [alpha] });
    open(sam);
    expect(within(screen.getByRole('dialog')).queryByRole('switch', { name: 'Show my projects only' })).toBeNull();
    await userEvent.click(screen.getByLabelText('Administrator'));
    await userEvent.click(mineSwitch());
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/u-sam')).toMatchObject({ roleNames: expect.arrayContaining(['ADMIN']), myProjectsOnly: true });
  });

  it('Administrator unticked: the switch goes, and nothing about it is sent', async () => {
    const server = companyServer({ companies: [alpha] });
    open(boss);
    await userEvent.click(mineSwitch());
    await userEvent.click(screen.getByLabelText('Administrator'));
    await userEvent.click(screen.getByLabelText('Employee'));
    expect(within(screen.getByRole('dialog')).queryByRole('switch', { name: 'Show my projects only' })).toBeNull();
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/u-boss')).not.toHaveProperty('myProjectsOnly');
  });

  it('the server’s refusal is shown in its words', async () => {
    const server = companyServer({ companies: [alpha] });
    server.refuseNext(403, 'FORBIDDEN', 'Only administrators have this setting.', { method: 'PUT', path: /^\/users\/u-boss$/ });
    open(boss);
    await userEvent.click(mineSwitch());
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Only administrators have this setting.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('your own account: the switch works (your roles stay locked), says “you”, and Settings shows the same value after saving', async () => {
    const me = apiUser({ id: 'me', username: 'admin', firstName: 'Ada', lastName: 'Admin', roles: ['ADMIN'], myProjectsOnly: false });
    const server = companyServer({ companies: [alpha] });
    // Settings reads the setting before the save (off) and again after it (on).
    server.answerNext('GET', /^\/users\/me\/preferences$/, { data: { timeZone: null, weekStart: null, myProjectsOnly: false } });
    server.answerNext('GET', /^\/users\/me\/preferences$/, { data: { timeZone: null, weekStart: null, myProjectsOnly: true } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyProjectsSettings />
        <EditUserModal user={me} onClose={onClose} />
      </QueryClientProvider>,
    );
    // Settings' own "Projects" section (the dialog has one too).
    const settings = screen.getAllByRole('region', { name: 'Projects' }).find((r) => !r.closest('[role="dialog"]'))!;
    await waitFor(() => expect(server.gets('/users/me/preferences')).toHaveLength(1));
    expect(within(settings).getByRole('switch', { name: 'Show my projects only' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Administrator')).toBeDisabled();
    const sw = mineSwitch();
    expect(sw).toBeEnabled();
    expect(sw).toHaveAccessibleDescription('Lists everywhere show only the projects you own, manage or are on the team of. You can still open any project by its link.');
    await userEvent.click(sw);
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/users/me')).toMatchObject({ myProjectsOnly: true });
    expect(server.lastBody('PUT', '/users/me')).not.toHaveProperty('roleNames');
    await waitFor(() => expect(within(settings).getByRole('switch', { name: 'Show my projects only' })).toHaveAttribute('aria-checked', 'true'));
  });
});
