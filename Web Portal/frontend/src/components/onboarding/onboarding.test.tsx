import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiUser } from '../../api/users';
import { useAuthStore } from '../../stores/auth-store';
import { AccountStatusDialog, statusChangeWords } from './AccountStatusDialog';
import { OnboardingStatusCell } from './OnboardingCells';
import { SignInSection } from './SignInSection';
import { EmailTaken, SameNameWarning, UsernameTaken, useIdentityCheck } from './identity';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
let calls: { url: string; method: string; body: unknown }[];
let emailEnabled: boolean;
let answers: Record<string, () => Response>;
beforeEach(() => {
  calls = [];
  emailEnabled = true;
  answers = {};
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x.co', username: 'boss', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', emailEnabled } });
      for (const [end, answer] of Object.entries(answers)) if (u.endsWith(end)) return answer();
      return json({ data: {} });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
const sara = (o: Partial<ApiUser> = {}): ApiUser => ({ id: 'u1', email: 'sara@x.co', username: 'sara', firstName: 'Sara', lastName: 'Ahmed', avatarUrl: null, status: 'ACTIVE', roles: ['EMPLOYEE'], lastLoginAt: null, welcomeSentAt: null, ...o });

describe('The status cell', () => {
  it('shows the badge and whether the email is verified; a lock is drawn for Locked', () => {
    const { container } = wrap(<OnboardingStatusCell person={{ status: 'ACTIVE', onboarding: 'LOCKED', emailVerifiedAt: '2026-11-01T00:00:00Z' }} />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Email verified ✓')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('Deactivate / reactivate: what happens is said first, with an optional reason', () => {
  it('names what happens and passes the reason', async () => {
    const done = vi.fn();
    wrap(<AccountStatusDialog name="Sara Ahmed" to="INACTIVE" onConfirm={done} onClose={() => {}} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Deactivate Sara Ahmed?' });
    expect(dialog).toHaveTextContent('They’re signed out everywhere at once — the website, the Android app and the extension');
    await userEvent.type(screen.getByLabelText(/^Reason/), 'Left the company');
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(done).toHaveBeenCalledWith('Left the company');
  });

  it('reactivating someone who never signed in says nothing is emailed by itself', () => {
    expect(statusChangeWords('Sara', 'ACTIVE', { neverSignedIn: true }).body.join(' ')).toContain('Nothing is emailed by itself: use Resend invitation');
    expect(statusChangeWords('Sara', 'SUSPENDED').title).toBe('Suspend Sara?');
  });
});

describe('Manage account: Sign-in & email', () => {
  it('resends the invitation, sends a password reset, and says what each does', async () => {
    answers['/welcome-email'] = () => json({ data: { userId: 'u1', email: 'sara@x.co', sent: true } });
    answers['/password-reset-email'] = () => json({ data: { userId: 'u1', email: 'sara@x.co', sent: true } });
    wrap(<SignInSection user={sara({ onboarding: 'INVITED', invitedAt: '2026-11-05T06:00:00Z', welcomeSentAt: '2026-11-05T06:00:00Z' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resend invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation resent to sara@x.co. The link works for 7 days; any earlier one (and an unused temporary password) stops working.');
    await userEvent.click(screen.getByRole('button', { name: 'Send password reset' }));
    expect(await screen.findByText(/Password reset link sent to sara@x\.co\. It works for an hour/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url.replace(/^.*\/api\/v1/, ''))).toEqual(['/users/u1/welcome-email', '/users/u1/password-reset-email']);
  });

  it('“Mark email as verified…” needs a reason, then sends it', async () => {
    answers['/email-verified'] = () => json({ data: sara({ emailVerifiedAt: '2026-11-07T08:00:00Z' }) });
    wrap(<SignInSection user={sara()} />);
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark email as verified…' }));
    expect(screen.getByRole('button', { name: 'Mark as verified' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why is this address right?'), 'Phoned them');
    await userEvent.click(screen.getByRole('button', { name: 'Mark as verified' }));
    await waitFor(() => expect(screen.getByText('Email verified ✓')).toBeInTheDocument());
    expect(calls.find((c) => c.url.endsWith('/email-verified'))!.body).toEqual({ reason: 'Phoned them' });
  });

  it('never for your own account, and nothing is sent for a deactivated one', async () => {
    wrap(<SignInSection user={sara({ id: 'me' })} />);
    expect(screen.queryByRole('button', { name: 'Mark email as verified…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  });

  it('deactivated: invitation and reset are off, and it says why', () => {
    wrap(<SignInSection user={sara({ status: 'INACTIVE' })} />);
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send password reset' })).toBeDisabled();
    expect(screen.getByText('The account is deactivated: reactivate it before sending anything.')).toBeInTheDocument();
  });

  it('with no mail settings, the email actions are off and it says to set a temporary password', async () => {
    emailEnabled = false;
    wrap(<SignInSection user={sara()} />);
    expect(await screen.findByText(/Email isn’t set up on this server, so invitations and reset links can’t be sent\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send password reset' })).toBeDisabled();
  });

  it('a refusal shows the server’s words', async () => {
    answers['/password-reset-email'] = () => json({ error: { code: 'TOO_SOON', message: 'No reset link was sent: a reset link was sent to them less than a minute ago.' } }, 429);
    wrap(<SignInSection user={sara()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send password reset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No reset link was sent: a reset link was sent to them less than a minute ago.');
  });
});

describe('Duplicate warnings while typing', () => {
  function Probe(props: { email?: string; username?: string; firstName?: string; lastName?: string; organisation?: string; client?: boolean }) {
    const found = useIdentityCheck(props);
    const open = vi.fn();
    return (
      <div>
        <EmailTaken id="e" match={found?.email ?? null} onOpen={open} />
        <UsernameTaken id="u" match={found?.username ?? null} onOpen={open} />
        <SameNameWarning matches={found?.sameName ?? []} onOpen={open} />
      </div>
    );
  }

  it('asks once the typing pauses, and says who has the email, the username and the same name at the organisation', async () => {
    const ahmed = { id: 'c1', name: 'Ahmed Al Harthy', username: 'ahmed', kind: 'client', organisation: 'Acme', status: 'ACTIVE' };
    answers['/users/identity-check'] = () => json({ data: { email: ahmed, username: ahmed, sameName: [{ ...ahmed, id: 'c2', name: 'Saif Al Said' }] } });
    wrap(<Probe email="ahmed@acme.com" username="ahmed" firstName="Saif" lastName="Al Said" organisation="Acme" client />);
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'This email is already used by Ahmed Al Harthy (client) — Open account')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Username taken by Ahmed Al Harthy (client) — Open account')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').startsWith('A client named Saif Al Said at Acme already exists.'))).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/users/identity-check'))!.body).toEqual({ email: 'ahmed@acme.com', username: 'ahmed', firstName: 'Saif', lastName: 'Al Said', client: true, organisation: 'Acme' });
  });

  it('a value that isn’t well-formed yet is not asked about', async () => {
    wrap(<Probe email="ahmed@" username="ah" />);
    await new Promise((r) => setTimeout(r, 600));
    expect(calls.some((c) => c.url.endsWith('/users/identity-check'))).toBe(false);
  });
});

// 1.23.6 addendum: the invitation's lifetime, Cancel invitation, and the temporary password line.
describe('Manage account: Sign-in & email (1.23.6)', () => {
  it('a lifetime for this invitation goes with the send', async () => {
    answers['/welcome-email'] = () => json({ data: { userId: 'u1', email: 'sara@x.co', sent: true } });
    wrap(<SignInSection user={sara({ onboarding: 'INVITED', invitedAt: '2026-11-05T06:00:00Z', welcomeSentAt: '2026-11-05T06:00:00Z' })} />);
    await userEvent.selectOptions(screen.getByLabelText('Invitation link works for'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Resend invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The link works for 3 days');
    expect(calls.find((c) => c.url.endsWith('/welcome-email'))!.body).toEqual({ days: 3 });
  });

  it('Cancel invitation for someone who never signed in: says what it does', async () => {
    answers['/invitation/cancel'] = () => json({ data: sara({ onboarding: 'INVITE_CANCELLED', invitationCancelledAt: '2026-11-07T08:00:00Z' }) });
    wrap(<SignInSection user={sara({ onboarding: 'INVITED', invitedAt: '2026-11-05T06:00:00Z', welcomeSentAt: '2026-11-05T06:00:00Z' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation cancelled. They can’t get in — no link, Forgot password or emailed code — until you send a new invitation or set a temporary password.');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url.replace(/^.*\/api\/v1/, ''))).toEqual(['/users/u1/invitation/cancel']);
  });

  it('no Cancel invitation once they have signed in, or after it was cancelled (which is said)', () => {
    const { unmount } = wrap(<SignInSection user={sara({ lastLoginAt: '2026-11-01T06:00:00Z', invitedAt: '2026-10-30T06:00:00Z' })} />);
    expect(screen.queryByRole('button', { name: 'Cancel invitation' })).toBeNull();
    unmount();
    wrap(<SignInSection user={sara({ onboarding: 'INVITE_CANCELLED', invitedAt: '2026-11-05T06:00:00Z', invitationCancelledAt: '2026-11-06T06:00:00Z' })} />);
    expect(screen.queryByRole('button', { name: 'Cancel invitation' })).toBeNull();
    expect(screen.getByText('The invitation is cancelled: no way in works until you send a new invitation or set a temporary password.')).toBeInTheDocument();
    expect(screen.getByText('Invitation cancelled')).toBeInTheDocument();
  });

  it('“A temporary password was set on … by …” — never the password', () => {
    wrap(
      <SignInSection
        user={sara({ mustChangePassword: true, temporaryPasswordSetAt: '2026-11-07T06:00:00Z', temporaryPasswordSetBy: { id: 'me', name: 'Khurram' }, temporaryPasswordExpiresAt: '2099-11-14T06:00:00Z' })}
      />,
    );
    expect(screen.getByText(/^A temporary password was set on 7 Nov( 2026)? by Khurram\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel invitation' })).toBeInTheDocument();
    // One way in: no reset link beside a temporary password (security review finding 6).
    expect(screen.getByRole('button', { name: 'Send password reset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send password reset' })).toHaveAccessibleDescription(/temporary password to change at their first sign-in/);
  });
});
