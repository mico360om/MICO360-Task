import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from './api-client';
import { ARCHIVE_TEXT, changeProjectStatus } from './project-status';
import { tabCounts } from './projects-page';
import { PROJECTS_OVERVIEW_KEY } from './refresh';
import type { ProjectOverview } from './types';
// LIST: six overview rows (testing/projects-overview-fixture.ts describes them); p1 is ACTIVE.
import { LIST } from '../testing/projects-overview-fixture';

/** An error isNetworkError recognises (no answer from the server), as the other tests build it. */
const networkError = () => new NetworkError('offline');
const overview = (qc: QueryClient) => qc.getQueryData<ProjectOverview[]>(PROJECTS_OVERVIEW_KEY)!;

describe('Review Focus 5: a status change with a real QueryClient', () => {
  it('offline: shown at once, put back with the offline sentence, counts as before', async () => {
    const qc = new QueryClient();
    qc.setQueryData(PROJECTS_OVERVIEW_KEY, LIST);
    let shownWhileSending: string | undefined;
    const update = vi.fn(() => {
      shownWhileSending = overview(qc).find((p) => p.id === 'p1')!.status;
      return Promise.reject(networkError());
    });
    const out = await changeProjectStatus(qc, { update, archive: vi.fn() }, LIST[0]!, 'ON_HOLD');
    expect(shownWhileSending).toBe('ON_HOLD');
    expect(out).toEqual({ ok: false, message: 'You’re offline — the status can be changed when you’re connected.' });
    expect(tabCounts(overview(qc))).toEqual(tabCounts(LIST));
  });

  it('online: kept, then the list is read again from the server, whose counts win', async () => {
    const qc = new QueryClient();
    qc.setQueryData(PROJECTS_OVERVIEW_KEY, LIST);
    qc.setQueryData(['project', 'p1'], { id: 'p1' });
    const update = vi.fn().mockResolvedValue({});
    expect(await changeProjectStatus(qc, { update, archive: vi.fn() }, LIST[0]!, 'ON_HOLD')).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith('p1', 'ON_HOLD');
    expect(qc.getQueryState(PROJECTS_OVERVIEW_KEY)!.isInvalidated).toBe(true);
    expect(qc.getQueryState(['project', 'p1'])!.isInvalidated).toBe(true);
    expect(tabCounts(overview(qc))).toMatchObject({ 'on-hold': 2 });
  });

  it('Archived goes through archive, and a refused archive says so', async () => {
    const qc = new QueryClient();
    qc.setQueryData(PROJECTS_OVERVIEW_KEY, LIST);
    const archive = vi.fn().mockRejectedValue(new ApiError(500, 'X', ''));
    const update = vi.fn();
    expect(await changeProjectStatus(qc, { update, archive }, LIST[0]!, 'ARCHIVED')).toEqual({ ok: false, message: 'Couldn’t archive the project. Try again.' });
    expect(archive).toHaveBeenCalledWith('p1');
    expect(update).not.toHaveBeenCalled();
    expect(tabCounts(overview(qc))).toEqual(tabCounts(LIST));
  });

  it('any other refusal names the project, as the website does', async () => {
    const qc = new QueryClient();
    qc.setQueryData(PROJECTS_OVERVIEW_KEY, LIST);
    const update = vi.fn().mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Insufficient role'));
    expect(await changeProjectStatus(qc, { update, archive: vi.fn() }, LIST[0]!, 'COMPLETED')).toEqual({ ok: false, message: 'Couldn’t change the status of Rig Inspection. Try again.' });
    expect(qc.getQueryState(PROJECTS_OVERVIEW_KEY)!.isInvalidated).toBe(true);
  });
});

it('the archive question’s words', () => {
  expect(ARCHIVE_TEXT.title('Rig')).toBe('Archive Rig?');
  expect(ARCHIVE_TEXT.confirm).toBe('Archive');
});
