import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import { bindQueryCacheToCompanyPick } from './company-scope';
import { openAuthedSocket } from './authedSocket';
import { useCompanyStore } from '../stores/company-store';
import { MY_COMPANIES_KEY } from '../api/companies';

type Handler = (...a: unknown[]) => void;
/** Every socket the page opens hears the event (the board, chat, the bell…): one handler list each. */
const sockets: Record<string, Handler>[] = [];
vi.mock('socket.io-client', () => ({
  io: () => {
    const handlers: Record<string, Handler> = {};
    sockets.push(handlers);
    return { connected: false, on: (ev: string, cb: Handler) => { handlers[ev] = cb; }, emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
  },
}));
const emitSocket = (event: string, payload: unknown) => {
  for (const s of sockets) s[event]?.(payload);
};

let unbind: () => void = () => {};
let qc: QueryClient;
beforeEach(() => {
  sockets.length = 0;
  useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: null });
  qc = new QueryClient();
  unbind = bindQueryCacheToCompanyPick(qc);
});
afterEach(() => {
  unbind();
  qc.clear();
});

describe('company scope', () => {
  it('after switching, no query answered with the old pick is shown', async () => {
    qc.setQueryData(['projects'], ['old']);
    qc.setQueryData(['tasks', 'mine'], ['old task']);
    qc.setQueryData(['app-config'], { timeZone: 'Asia/Muscat' });
    qc.setQueryData(MY_COMPANIES_KEY, { companies: [] });
    act(() => useCompanyStore.getState().setPick('u1', 'B'));
    expect(qc.getQueryData(['projects'])).toBeUndefined();
    expect(qc.getQueryData(['tasks', 'mine'])).toBeUndefined();
    expect(qc.getQueryData(['app-config'])).toEqual({ timeZone: 'Asia/Muscat' });
    expect(qc.getQueryData(MY_COMPANIES_KEY)).toEqual({ companies: [] });
  });

  it('a pick cleared because it was refused resets the lists too', () => {
    act(() => useCompanyStore.getState().setPick('u1', 'B'));
    qc.setQueryData(['projects'], ['B only']);
    act(() => useCompanyStore.getState().companyGone());
    expect(qc.getQueryData(['projects'])).toBeUndefined();
  });

  it('a request still on its way under the old pick is cancelled', () => {
    const cancel = vi.spyOn(qc, 'cancelQueries');
    act(() => useCompanyStore.getState().setPick('u1', 'B'));
    expect(cancel).toHaveBeenCalled();
  });

  it('picking the company already picked changes nothing', () => {
    act(() => useCompanyStore.getState().setPick('u1', 'B'));
    qc.setQueryData(['projects'], ['B']);
    act(() => useCompanyStore.getState().setPick('u1', 'B'));
    expect(qc.getQueryData(['projects'])).toEqual(['B']);
  });

  it('companies:changed re-reads my companies and resets lists', async () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const reset = vi.spyOn(qc, 'resetQueries');
    openAuthedSocket();
    emitSocket('companies:changed', {});
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me', 'companies'] }));
    expect(reset).toHaveBeenCalled();
  });

  it('heard on every open socket at once, it resets the lists once', async () => {
    const reset = vi.spyOn(qc, 'resetQueries');
    openAuthedSocket();
    openAuthedSocket();
    openAuthedSocket();
    emitSocket('companies:changed', {});
    await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 400));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('once unbound, nothing happens', async () => {
    unbind();
    const reset = vi.spyOn(qc, 'resetQueries');
    openAuthedSocket();
    emitSocket('companies:changed', {});
    act(() => useCompanyStore.getState().setPick('u1', 'B'));
    await new Promise((r) => setTimeout(r, 400));
    expect(reset).not.toHaveBeenCalled();
  });
});
