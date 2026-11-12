import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TourSettingsCard } from './TourSettingsCard';
import { fakeTrainingApi, settings, type FakeTrainingApi } from './test-api';
import { renderManage } from './test-render';
import { ApiError } from '../../../lib/api-client';

let api: FakeTrainingApi;
const fake = vi.hoisted(() => ({ api: null as FakeTrainingApi | null }));
vi.mock('../../../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/training')>()),
  trainingApi: (await import('./test-api')).followFake(() => fake.api),
}));

beforeEach(() => {
  api = fake.api = fakeTrainingApi();
  api.settings.mockResolvedValue(settings({ tourOff: ['co-b'] }));
});

// 12 Nov (design §6): the tour switch moved from Manage's own Settings tab into System Settings, unchanged (per company).
describe('System Settings → Learning Hub (the first-time tour)', () => {
  it('a card titled Learning Hub: the tour on or off per company; a change is saved at once', async () => {
    renderManage(<TourSettingsCard />);
    expect(screen.getByRole('heading', { name: 'Learning Hub' })).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'First-time tour: Alpha Co' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'First-time tour: Beta Co' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/new accounts see a short tour/i)).toBeInTheDocument();
    // The corrected words: seen again from Tour of the site (no "Help").
    expect(screen.getByText(/Tour of the site/)).toBeInTheDocument();
    expect(screen.queryByText(/from Help/)).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'First-time tour: Alpha Co' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ tourOff: ['co-b', 'co-a'] }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'First-time tour: Alpha Co' })).toHaveAttribute('aria-checked', 'false'));
    await userEvent.click(screen.getByRole('switch', { name: 'First-time tour: Beta Co' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenLastCalledWith({ tourOff: ['co-a'] }));
  });

  it('a refused change is said and the switch shows what is saved', async () => {
    api.saveSettings.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Only administrators can change this.'));
    renderManage(<TourSettingsCard />);
    await userEvent.click(await screen.findByRole('switch', { name: 'First-time tour: Alpha Co' }));
    expect(await screen.findByText(/Only administrators can change this\./)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'First-time tour: Alpha Co' })).toHaveAttribute('aria-checked', 'true');
  });
});
