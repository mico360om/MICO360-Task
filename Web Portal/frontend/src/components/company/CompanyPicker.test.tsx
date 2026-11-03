import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanyPicker } from './CompanyPicker';
import { CompanyLogo } from './CompanyLogo';
import { useCompanyStore } from '../../stores/company-store';
import { useAuthStore } from '../../stores/auth-store';
import { MY_COMPANIES_KEY, type MyCompanies, type MyCompany } from '../../api/companies';

const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string, logoUrl: string | null = null): MyCompany => ({ id, name, code: id.toUpperCase(), logoUrl, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const alpha = company('a', 'Alpha Co', '/uploads/alpha.png');
const beta = company('b', 'Beta Co');
const gamma = company('g', 'شركة غاما');

function renderPicker(companies: MyCompany[], more: Partial<MyCompanies> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(MY_COMPANIES_KEY, { companies, primaryCompanyId: null, allArchived: false, siteCompanyCount: companies.length, ...more });
  return render(
    <QueryClientProvider client={qc}>
      <div>
        <CompanyPicker />
        <button type="button">Elsewhere</button>
      </div>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  useCompanyStore.setState({ pick: null, notice: null, noticeName: null, names: {}, userId: 'u1' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CompanyPicker', () => {
  it('nothing at all with one company', () => {
    const { container } = renderPicker([alpha]);
    expect(container.querySelector('[data-company-picker]')).toBeNull();
  });

  it('a menu button: closed until pressed, then the picked one is ticked and has focus', async () => {
    useCompanyStore.setState({ pick: 'b' });
    renderPicker([alpha, beta]);
    const btn = screen.getByRole('button', { name: 'Company: Beta Co' });
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(items[2]).toHaveFocus();
  });

  it('arrow keys go round, Home and End jump, Enter picks', async () => {
    renderPicker([beta, alpha]);
    await userEvent.click(screen.getByRole('button', { name: 'Company: All my companies' }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(items[2]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(items[2]).toHaveFocus();
    await userEvent.keyboard('{Home}{ArrowDown}{Enter}');
    expect(useCompanyStore.getState().pick).toBe('a');
    expect(screen.getByRole('button', { name: 'Company: Alpha Co' })).toHaveFocus();
  });

  it('"All my companies" goes back to every company and forgets the saved one', async () => {
    useCompanyStore.getState().setPick('u1', 'a');
    renderPicker([alpha, beta]);
    await userEvent.click(screen.getByRole('button', { name: 'Company: Alpha Co' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'All my companies' }));
    expect(useCompanyStore.getState().pick).toBeNull();
    expect(localStorage.getItem('mico360.u.u1.company.pick')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a press elsewhere or Tab closes it without changing the pick', async () => {
    renderPicker([alpha, beta]);
    const btn = screen.getByRole('button', { name: 'Company: All my companies' });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(btn);
    await userEvent.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useCompanyStore.getState().pick).toBeNull();
  });

  it('pressing the button again closes it', async () => {
    renderPicker([alpha, beta]);
    const btn = screen.getByRole('button', { name: 'Company: All my companies' });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('each company with its logo (or a building), and names kept in their own direction', async () => {
    renderPicker([alpha, beta, gamma]);
    await userEvent.click(screen.getByRole('button', { name: 'Company: All my companies' }));
    const item = (name: string) => screen.getByRole('menuitemradio', { name });
    expect(item('Alpha Co').querySelector('img')?.getAttribute('src')).toMatch(/\/uploads\/alpha\.png$/);
    expect(item('Alpha Co').querySelector('img')).toHaveAttribute('alt', '');
    expect(item('Beta Co').querySelector('img')).toBeNull();
    expect(item('Beta Co').querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(item('شركة غاما').querySelector('bdi')).toHaveTextContent('شركة غاما');
    expect(screen.getByRole('menu')).toHaveAccessibleName('Company');
  });

  it('a finger-sized button and items on a touch screen', async () => {
    renderPicker([alpha, beta]);
    const btn = screen.getByRole('button', { name: 'Company: All my companies' });
    expect(btn.className).toContain('[@media(pointer:coarse)]:!min-h-11');
    expect(btn.className).toContain('[@media(pointer:coarse)]:!min-w-11');
    await userEvent.click(btn);
    for (const item of screen.getAllByRole('menuitemradio')) expect(item.className).toContain('[@media(pointer:coarse)]:!min-h-11');
  });
});

describe('CompanyLogo', () => {
  it('the logo when there is one, else a building that screen readers skip', () => {
    const { container, rerender } = render(<CompanyLogo company={{ name: 'Alpha Co', logoUrl: '/uploads/alpha.png' }} size={20} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/\/uploads\/alpha\.png$/);
    expect(img).toHaveAttribute('width', '20');
    rerender(<CompanyLogo company={{ name: 'Beta Co', logoUrl: null }} size={32} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<CompanyLogo company={null} size={16} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('a logo that can’t be loaded becomes the building', async () => {
    const { container } = render(<CompanyLogo company={{ name: 'Alpha Co', logoUrl: '/uploads/gone.png' }} size={20} />);
    const img = container.querySelector('img')!;
    img.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('can name the company when the logo stands alone', () => {
    const { container } = render(<CompanyLogo company={{ name: 'Alpha Co', logoUrl: '/uploads/alpha.png' }} size={48} alt="Alpha Co" />);
    expect(container.querySelector('img')).toHaveAttribute('alt', 'Alpha Co');
  });
});
