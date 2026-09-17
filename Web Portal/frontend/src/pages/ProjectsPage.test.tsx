import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { ProjectsPage } from './ProjectsPage';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: 'Internal', status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' },
        ],
      }),
    ),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage', () => {
  it('loads and renders projects fetched from the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('MICO360 Platform')).toBeInTheDocument());
  });
});
