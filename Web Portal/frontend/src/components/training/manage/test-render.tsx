import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/** Test code only: the page or tab inside a fresh query cache and a router at `path`. */
export function renderManage(ui: ReactElement, { path = '/training/manage', route, seed }: { path?: string; route?: string; seed?: (qc: QueryClient) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // The site's time zone (/config) as the shell has it: no request in a test.
  qc.setQueryData(['app-config'], { timeZone: 'Asia/Muscat', productName: 'MICO360 Tasks', companyName: 'MICO360', emailEnabled: true, weekStart: 0 });
  seed?.(qc);
  const where: { path: string } = { path };
  function Where() {
    const loc = useLocation();
    where.path = loc.pathname + loc.search;
    return null;
  }
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        {route ? (
          <Routes>
            <Route path={route} element={ui} />
            <Route path="*" element={<p>Somewhere else</p>} />
          </Routes>
        ) : (
          ui
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, qc, where };
}
