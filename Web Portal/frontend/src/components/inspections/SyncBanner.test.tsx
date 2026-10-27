import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncAnnouncer, SyncBanner } from './SyncBanner';
import type { DraftView, OutboxProblem } from '../../lib/inspection-outbox';

const view = (over: Partial<DraftView> = {}): DraftView =>
  ({
    inspectionId: 'i1',
    projectId: 'p1',
    title: 'Rig daily check',
    status: 'IN_PROGRESS',
    snapshot: {} as DraftView['snapshot'],
    answers: [],
    counts: { total: 2, answered: 1, passed: 1, failed: 0, na: 0 },
    pending: { answers: 2, finish: false, followUps: 0 },
    followUpsWaiting: [],
    problem: null,
    persisted: true,
    locked: false,
    retryAt: null,
    lastFailure: null,
    finishedOffer: null,
    savedAt: '',
    sentAt: null,
    ...over,
  }) as DraftView;
const problem = (over: Partial<OutboxProblem>): OutboxProblem => ({ code: 'X', message: 'Refused.', stage: 'answers', at: '', ...over });

const show = (v: DraftView, props: Partial<Parameters<typeof SyncBanner>[0]> = {}) => {
  const handlers = { onRetry: vi.fn(), onDiscard: vi.fn(), onLookAgain: vi.fn(), onDismiss: vi.fn() };
  render(<SyncBanner view={v} sync="idle" online {...handlers} {...props} />);
  return handlers;
};

describe('where the changes are', () => {
  it('without signal: saved on this phone, will send when online', () => {
    show(view(), { online: false, sync: 'offline' });
    expect(screen.getByTestId('sync-state')).toHaveTextContent('Saved on this phone, will send when online: 2 answers.');
  });

  it('storage full: only in this page', () => {
    show(view({ persisted: false }));
    expect(screen.getByTestId('sync-state')).toHaveTextContent('only in this page');
  });

  it('signed out: sign in again to send them', () => {
    show(view(), { sync: 'signed-out' });
    expect(screen.getByTestId('sync-state')).toHaveTextContent('Sign in again to send them.');
  });

  it('a refused follow-up request is a note to read; the answers’ status still shows', async () => {
    const h = show(view({ problem: problem({ stage: 'follow-ups', message: 'Only active members of the project can be assigned.' }) }), { sync: 'sending' });
    expect(screen.getByRole('alert')).toHaveTextContent('Only active members');
    expect(screen.getByTestId('sync-state')).toHaveTextContent('Sending 2 answers');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(h.onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Throw away/ })).toBeNull();
  });

  it('a refused finish asks to look again', async () => {
    const h = show(view({ problem: problem({ stage: 'finish', code: 'INSPECTION_REOPENED', message: 'This inspection was reopened.' }) }));
    await userEvent.click(screen.getByRole('button', { name: 'Look again' }));
    expect(h.onLookAgain).toHaveBeenCalled();
  });

  it('refused answers: try again, or throw away what is on this phone (a deleted inspection: only throw away)', async () => {
    const h = show(view({ problem: problem({ code: 'NOT_THE_INSPECTOR', message: 'Olivia is carrying it out now.' }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('Still on this phone: 2 answers.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await userEvent.click(screen.getByRole('button', { name: 'Throw away what’s on this phone' }));
    expect(h.onRetry).toHaveBeenCalled();
    expect(h.onDiscard).toHaveBeenCalled();
  });

  it('a deleted inspection offers only throwing it away', () => {
    show(view({ problem: problem({ code: 'INSPECTION_GONE', message: 'Deleted.' }) }));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Throw away what’s on this phone' })).toBeInTheDocument();
  });
});

describe('the calm states (server errors never lock anything)', () => {
  it('a server that can’t be reached: will keep trying, with Try now', async () => {
    const h = show(view({ lastFailure: 'unreachable', retryAt: '2026-10-27T08:00:10.000Z' }));
    expect(screen.getByTestId('sync-state')).toHaveTextContent('Can’t reach the server, will keep trying. Saved on this phone: 2 answers.');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try now' }));
    expect(h.onRetry).toHaveBeenCalled();
  });
});

describe('what a screen reader hears', () => {
  it('only going offline, and everything sent once back — not every send', () => {
    const { rerender } = render(<SyncAnnouncer view={view()} sync="sending" online />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('');
    rerender(<SyncAnnouncer view={view()} sync="offline" online={false} />);
    expect(region).toHaveTextContent('No signal. Changes are saved on this phone');
    rerender(<SyncAnnouncer view={view()} sync="sending" online />);
    expect(region).toHaveTextContent('No signal.');
    rerender(<SyncAnnouncer view={view({ pending: { answers: 0, finish: false, followUps: 0 } })} sync="idle" online />);
    expect(region).toHaveTextContent('Back online: all changes sent.');
  });
});
