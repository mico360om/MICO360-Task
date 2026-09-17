import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { AuditPage } from './AuditPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 'a1', userId: 'admin', action: 'USER_CREATED', module: 'users', entityId: 'u9', createdAt: '2026-06-15T12:00:00Z' }] })));
});
afterEach(() => vi.restoreAllMocks());

describe('AuditPage', () => {
  it('renders audit entries from the API', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuditPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('USER_CREATED')).toBeInTheDocument());
  });
});
