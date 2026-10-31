import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectionClientSwitch } from './InspectionClientSwitch';
import type { ClientInspection } from '../../api/inspections';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const report = (place: string): ClientInspection => ({
  id: 'i1', title: 'Rig daily check', date: '2026-10-27', place, counts: { total: 1, passed: 1, failed: 0, na: 0 }, result: 'Passed',
  sections: [{ title: 'Deck', items: [{ label: 'Rails', kind: 'CHECK', result: 'Pass', reading: null, limits: null, note: null }] }],
  signatures: [], unsigned: [], revisionNumber: 1, reopenedOn: null,
});

let preview: () => Response | Promise<Response>;
let calls: Array<{ method: string; path: string }>;
beforeEach(() => {
  calls = [];
  preview = () => json({ data: { inspection: report('Rig 3'), names: [] } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).replace(/^.*\/api\/v1/, '');
    calls.push({ method, path });
    if (method === 'GET' && path === '/inspections/i1/client-visibility/preview') return preview();
    return json({ data: { clientVisible: true } });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Show an inspection report to the client', () => {
  it('opened again, the preview is read again first: the old one can’t be confirmed meanwhile (final pass, item 7)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <InspectionClientSwitch inspectionId="i1" clientVisible={false} canChange onChanged={vi.fn()} />
      </QueryClientProvider>,
    );
    const toggle = screen.getByRole('switch', { name: 'Show to client' });
    await userEvent.click(toggle);
    let dialog = await screen.findByRole('dialog', { name: 'Show this report to the client?' });
    await within(dialog).findByText('Rig 3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The report was reopened and signed again meanwhile; the new preview takes a moment.
    let release: () => void = () => {};
    preview = () => new Promise<Response>((r) => { release = () => r(json({ data: { inspection: report('Rig 4'), names: [] } })); });
    await userEvent.click(toggle);
    dialog = await screen.findByRole('dialog', { name: 'Show this report to the client?' });
    expect(within(dialog).getByText('Loading…')).toBeInTheDocument();
    expect(within(dialog).queryByText('Rig 3')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Show to client' })).toBeDisabled();
    release();
    expect(await within(dialog).findByText('Rig 4')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show to client' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/inspections/i1/client-visibility')).toBe(true));
  });
});
