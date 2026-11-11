import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OverdueTrainingLink } from './OverdueTrainingLink';

const staff = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('../../api/training', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/training')>()), trainingApi: () => staff }));

const ACCESS = { learner: true, manager: false, admin: false, teamReports: false, overdue: 0, assigned: 0, tour: { show: false } };
const renderLink = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OverdueTrainingLink />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  staff.access.mockReset();
});

describe('the dashboard’s “Overdue training”', () => {
  it('a red link with the number, opening My training', async () => {
    staff.access.mockResolvedValue({ ...ACCESS, overdue: 3 });
    renderLink();
    const link = await screen.findByRole('link', { name: /Overdue training — 3/ });
    expect(link).toHaveAttribute('href', '/training');
    expect(link.className).toContain('text-overdue');
  });

  it('nothing when none is overdue', async () => {
    staff.access.mockResolvedValue(ACCESS);
    const { container } = renderLink();
    await waitFor(() => expect(staff.access).toHaveBeenCalled());
    expect(container.querySelector('a')).toBeNull();
  });

  it('is on the dashboard', () => {
    expect(readFileSync(join(__dirname, '../../pages/DashboardPage.tsx'), 'utf8')).toMatch(/<OverdueTrainingLink \/>/);
  });
});
