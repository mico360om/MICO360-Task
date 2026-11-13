import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../lib/api-client';
import { trainingApi } from './training';

// Assigning several people, withdrawing them together, and the reports' "Dates by" (1.23.30).
function fakeClient() {
  const answer = vi.fn(async () => ({ data: { ok: true } }));
  const client = { get: answer, post: answer, put: answer, patch: answer, del: answer, upload: answer, getText: vi.fn(), getBlob: vi.fn(async () => new Blob(['x'])) };
  return { client: client as unknown as ApiClient, calls: client };
}

describe('Training Center API: several people and report dates', () => {
  it('assigns several people in one body and withdraws the whole batch', async () => {
    const { client, calls } = fakeClient();
    const api = trainingApi(client);
    await api.assign({ courseIds: ['c1'], targetKind: 'PEOPLE', userIds: ['u1', 'u2'], mandatory: true });
    expect(calls.post).toHaveBeenLastCalledWith('/training/manage/assignments', { courseIds: ['c1'], targetKind: 'PEOPLE', userIds: ['u1', 'u2'], mandatory: true });
    await api.withdrawBatch('b 1');
    expect(calls.del).toHaveBeenLastCalledWith('/training/manage/assignment-batches/b%201');
  });

  it('sends dates with the report and its files (left out when not chosen)', async () => {
    const { client, calls } = fakeClient();
    const api = trainingApi(client);
    await api.report({ by: 'course', dates: 'finished' });
    expect(calls.get).toHaveBeenLastCalledWith('/training/reports?by=course&dates=finished');
    await api.report({ by: 'course' });
    expect(calls.get).toHaveBeenLastCalledWith('/training/reports?by=course');
    await api.reportFile({ by: 'person', dates: 'finished' }, 'pdf');
    expect(calls.getBlob).toHaveBeenLastCalledWith('/training/reports/export.pdf?by=person&dates=finished');
  });
});
