import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { bindCompanyPickToSession, useCompanyStore } from './company-store';
import { useAuthStore } from './auth-store';
import { clearUserStorage } from '../lib/user-storage';

const reset = () => useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: null });

beforeEach(() => {
  localStorage.clear();
  reset();
});

describe('the company store', () => {
  it('the pick is per person, kept on this device, and survives sign-out', () => {
    useCompanyStore.getState().setPick('u1', 'B');
    expect(localStorage.getItem('mico360.u.u1.company.pick')).toBe('B');
    clearUserStorage();
    useCompanyStore.getState().loadFor('u1');
    expect(useCompanyStore.getState().pick).toBe('B');
    useCompanyStore.getState().loadFor('u2');
    expect(useCompanyStore.getState().pick).toBeNull();
  });

  it('"All my companies" forgets the saved pick', () => {
    useCompanyStore.getState().setPick('u1', 'B');
    useCompanyStore.getState().setPick('u1', null);
    expect(localStorage.getItem('mico360.u.u1.company.pick')).toBeNull();
    expect(useCompanyStore.getState().pick).toBeNull();
  });

  it('a gone pick is cleared (saved too) with a notice that names the company', () => {
    useCompanyStore.getState().setNames({ B: 'Beta Co' });
    useCompanyStore.getState().setPick('u1', 'B');
    useCompanyStore.getState().companyGone();
    const s = useCompanyStore.getState();
    expect(s.pick).toBeNull();
    expect(localStorage.getItem('mico360.u.u1.company.pick')).toBeNull();
    expect(s.notice).toBe('You no longer have access to Beta Co. Showing all your companies.');
    s.dismissNotice();
    expect(useCompanyStore.getState().notice).toBeNull();
  });

  it('without the company’s name the notice says "that company"', () => {
    useCompanyStore.getState().setPick('u1', 'C');
    useCompanyStore.getState().companyGone();
    expect(useCompanyStore.getState().notice).toBe('You no longer have access to that company. Showing all your companies.');
  });

  it('several refusals of one pick give one notice; a refusal of an older pick leaves the new one', () => {
    useCompanyStore.getState().setNames({ B: 'Beta Co', A: 'Alpha Co' });
    useCompanyStore.getState().setPick('u1', 'B');
    useCompanyStore.getState().companyGone('B');
    useCompanyStore.getState().companyGone('B');
    expect(useCompanyStore.getState().notice).toBe('You no longer have access to Beta Co. Showing all your companies.');
    useCompanyStore.getState().dismissNotice();
    useCompanyStore.getState().setPick('u1', 'A');
    useCompanyStore.getState().companyGone('B'); // a late answer to a request sent under the old pick
    expect(useCompanyStore.getState().pick).toBe('A');
    expect(useCompanyStore.getState().notice).toBeNull();
  });

  it('names are added to, never forgotten (a company just taken away can still be named)', () => {
    useCompanyStore.getState().setNames({ A: 'Alpha Co', B: 'Beta Co' });
    useCompanyStore.getState().setNames({ A: 'Alpha Co' });
    expect(useCompanyStore.getState().names).toEqual({ A: 'Alpha Co', B: 'Beta Co' });
  });

  it('the pick follows whoever is signed in', () => {
    localStorage.setItem('mico360.u.u1.company.pick', 'B');
    const unbind = bindCompanyPickToSession();
    act(() => useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' }));
    expect(useCompanyStore.getState().pick).toBe('B');
    act(() => useAuthStore.getState().logout('remote'));
    expect(useCompanyStore.getState().pick).toBeNull();
    expect(localStorage.getItem('mico360.u.u1.company.pick')).toBe('B');
    act(() => useAuthStore.getState().setSession({ user: { id: 'u2', email: 'b@b.c', username: 'bob', roles: [] }, accessToken: 'at2', refreshToken: 'rt2' }));
    expect(useCompanyStore.getState().pick).toBeNull();
    unbind();
  });
});
