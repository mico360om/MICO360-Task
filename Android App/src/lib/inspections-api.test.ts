import { it, expect } from 'vitest';
import { DETAIL } from '../testing/inspection-fixtures';
import { ApiError, NetworkError, type ApiClient } from './api-client';
import { createInspectionOutbox, memoryDraftStorage } from './inspection-outbox';
import { inspectionsApi } from './inspections-api';

/** The inspection calls (Stage 4): what reaches the outbox when something other than the server answers (Final I7). */

const failing = (e: unknown): Pick<ApiClient, 'get' | 'post' | 'put' | 'del'> => {
  const fail = async () => {
    throw e;
  };
  return { get: fail, post: fail, put: fail, del: fail } as unknown as Pick<ApiClient, 'get' | 'post' | 'put' | 'del'>;
};

it('a page in the way — a proxy or firewall answering without the server’s JSON — is no signal, not a refusal (Final I7)', async () => {
  for (const status of [403, 404, 413, 502, 503]) {
    await expect(inspectionsApi(failing(new ApiError(status, 'ERROR', `Request failed (${status})`))).answer('i1', []), String(status)).rejects.toBeInstanceOf(NetworkError);
  }
  // The server's own refusals stay what they are.
  const finished = new ApiError(409, 'INSPECTION_FINISHED', 'This inspection is already finished.');
  await expect(inspectionsApi(failing(finished)).finish('i1', { finishId: 'f', revision: 0, seen: [], signatures: [] })).rejects.toBe(finished);
  const gone = new ApiError(404, 'NOT_FOUND', 'Inspection not found');
  await expect(inspectionsApi(failing(gone)).get('i1')).rejects.toBe(gone);
  // A 401 is a session for the client to renew (the outbox's 'signed-out'), whatever its body.
  const signedOut = new ApiError(401, 'ERROR', 'Request failed (401)');
  await expect(inspectionsApi(failing(signedOut)).get('i1')).rejects.toBe(signedOut);
});

it('so the outbox keeps the answers and tries again, and never offers to throw them away', async () => {
  const o = createInspectionOutbox({ storage: memoryDraftStorage(), api: inspectionsApi(failing(new ApiError(404, 'ERROR', 'Request failed (404)'))) });
  o.remember('u1', DETAIL);
  o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
  expect((await o.flush('u1', 'i1')).state).toBe('offline');
  expect(o.view('u1', 'i1')).toMatchObject({ problem: null, pending: { answers: 1 } });
});
