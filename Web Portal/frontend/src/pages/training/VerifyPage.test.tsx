import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { useAuthStore } from '../../stores/auth-store';

/** The public check, through the whole site's router (signed out): only the server's five facts. */
let calls: string[] = [];
let answer: (url: string) => Response = () => new Response('{}', { status: 404 });

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const FACTS = { courseTitle: 'Tasks basics', learnerName: 'Mariam Al Balushi', issuedAt: '2026-11-05T08:00:00.000Z', expiresAt: '2027-11-05T08:00:00.000Z', completedAt: '2026-11-03T08:00:00.000Z' };

beforeEach(() => {
  useAuthStore.getState().logout('remote');
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return answer(String(url));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Check a certificate (/verify, public)', () => {
  it('signed out, outside the site’s shell: course, name, dates and Valid', async () => {
    answer = (url) => (url.includes('/training/verify/') ? json({ data: { ...FACTS, status: 'VALID' } }) : json({}, 404));
    renderAt('/verify/TC-ABCD-EFGH-JKLM');
    expect(await screen.findByRole('heading', { level: 1, name: 'Check a certificate' })).toBeInTheDocument();
    expect(await screen.findByText('Mariam Al Balushi')).toBeInTheDocument();
    expect(screen.getByText('Tasks basics')).toBeInTheDocument();
    expect(screen.getByText('5 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('5 Nov 2027')).toBeInTheDocument();
    // The day the course was finished (the certificate's date line), first.
    expect(screen.getByText('Completed').nextElementSibling).toHaveTextContent('3 Nov 2026');
    expect(screen.getByText('Completed').compareDocumentPosition(screen.getByText('Issued')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-verify-status="VALID"]')).toHaveTextContent('Valid');
    expect(screen.getByTestId('where')).toHaveTextContent('/verify/TC-ABCD-EFGH-JKLM');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByText('Issued through MICO360 Tasks · Learning Hub')).toBeInTheDocument();
    expect(calls.filter((u) => u.includes('/training/verify/'))).toEqual([expect.stringMatching(/\/training\/verify\/TC-ABCD-EFGH-JKLM$/)]);
  });

  it('expired and revoked say so', async () => {
    answer = () => json({ data: { ...FACTS, status: 'EXPIRED' } });
    const one = renderAt('/verify/TC-AAAA-BBBB-CCCC');
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('This certificate has passed its expiry date.')).toBeInTheDocument();
    one.unmount();
    answer = () => json({ data: { ...FACTS, expiresAt: null, status: 'REVOKED' } });
    renderAt('/verify/TC-DDDD-EEEE-FFFF');
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('an unknown code: “No certificate has this code”', async () => {
    answer = () => json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    renderAt('/verify/TC-ZZZZ-ZZZZ-ZZZZ');
    expect(await screen.findByText('No certificate has this code.')).toBeInTheDocument();
  });

  it('a code with a percent sign in the address doesn’t break the page (it is read once, never decoded twice)', async () => {
    answer = () => json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    renderAt('/verify/%25');
    expect(await screen.findByText('No certificate has this code.')).toBeInTheDocument();
    expect(calls.filter((u) => u.includes('/training/verify/'))).toEqual([expect.stringMatching(/\/training\/verify\/%25$/)]);
    expect(screen.getByLabelText('Certificate code')).toHaveValue('%');
  });

  it('/verify: a box for the code (tidied: capitals, no spaces) that opens its check', async () => {
    answer = () => json({ data: { ...FACTS, status: 'VALID' } });
    renderAt('/verify');
    const box = await screen.findByLabelText('Certificate code');
    await userEvent.type(box, ' tc-abcd-efgh-jklm ');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/verify/TC-ABCD-EFGH-JKLM'));
    expect(await screen.findByText('Mariam Al Balushi')).toBeInTheDocument();
  });
});
