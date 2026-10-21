import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import {
  PICTURE_MAX_BYTES,
  checkDraft,
  clientSuggestions,
  codeError,
  codeNote,
  createBody,
  draftOf,
  isDirty,
  nameChanged,
  pictureChoiceFor,
  picturePart,
  pictureProblem,
  priorityOptions,
  projectChanges,
  saveProject,
  statusOptions,
  typedCode,
  type ProjectSaveApi,
} from './project-form';
import type { ApiProject } from './types';

const project = (patch: Partial<ApiProject> = {}): ApiProject => ({
  id: 'p1',
  code: 'RIG',
  number: null,
  name: 'Rig Inspection',
  description: null,
  status: 'ACTIVE',
  clientName: 'PDO',
  priority: 'HIGH',
  startDate: null,
  targetDate: null,
  color: '#2E7D53',
  icon: 'truck',
  imageUrl: null,
  ownerId: 'u1',
  ...patch,
});

describe('the form’s starting point', () => {
  it('is empty for a new project, in the website’s defaults', () => {
    expect(draftOf(null)).toEqual({ name: '', code: '', number: '', clientName: '', description: '', status: 'PLANNING', priority: 'NORMAL', ownerId: '', color: '#8B1E1E', icon: null });
  });

  it('is the project as it is for an edit', () => {
    expect(draftOf(project())).toEqual({ name: 'Rig Inspection', code: 'RIG', number: '', clientName: 'PDO', description: '', status: 'ACTIVE', priority: 'HIGH', ownerId: 'u1', color: '#2E7D53', icon: 'truck' });
  });

  it('offers Archived only for a project that already is', () => {
    expect(statusOptions('PLANNING').map((o) => o.label)).toEqual(['Planning', 'Active', 'On hold', 'Completed']);
    expect(statusOptions('ARCHIVED').map((o) => o.value)).toEqual(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);
    expect(priorityOptions().map((o) => o.label)).toEqual(['Low', 'Normal', 'High', 'Urgent']);
  });
});

describe('the code', () => {
  it('is suggested from the name until it is typed in (new projects only)', () => {
    const d = draftOf(null);
    expect(nameChanged(d, 'Rig Inspection Portal', { codeTouched: false, editing: false }).code).toBe('RIP');
    expect(nameChanged({ ...d, code: 'MINE' }, 'Rig Inspection Portal', { codeTouched: true, editing: false }).code).toBe('MINE');
    expect(nameChanged(draftOf(project()), 'Renamed', { codeTouched: false, editing: true }).code).toBe('RIG');
  });

  it('is typed in capitals without spaces', () => {
    expect(typedCode('hr 2 ')).toBe('HR2');
  });

  it('says what it will be, whether it is free, or what is wrong — in the website’s words', () => {
    expect(codeNote({ editing: true, code: 'RIG', error: null, check: null })).toEqual({ text: 'Task keys use this code, so it can’t be changed.', tone: 'note' });
    expect(codeNote({ editing: false, code: '', error: null, check: null })).toEqual({ text: 'Suggested from the name — you can change it.', tone: 'note' });
    expect(codeNote({ editing: false, code: 'RIP', error: null, check: null })).toEqual({ text: 'Task keys look like RIP-12.', tone: 'note' });
    expect(codeNote({ editing: false, code: 'RIP', error: null, check: { code: 'RIP', valid: true, available: true } })).toEqual({ text: 'RIP is free.', tone: 'success' });
    expect(codeNote({ editing: false, code: 'MICO', error: 'MICO is already used by another project.', check: { code: 'MICO', valid: true, available: false, suggestion: 'MICO2' } })).toEqual({
      text: 'MICO is already used by another project.',
      tone: 'error',
      suggestion: 'MICO2',
    });
  });

  it('is checked as typed: its form first, then whether the server says it is taken', () => {
    expect(codeError('2X', { editing: false, check: null })).toBe('Codes start with a letter.');
    expect(codeError('MICO', { editing: false, check: { code: 'MICO', valid: true, available: false } })).toBe('MICO is already used by another project.');
    expect(codeError('MICO', { editing: false, check: { code: 'MIC', valid: true, available: false } })).toBeNull();
    expect(codeError('', { editing: false, check: null })).toBeNull();
    expect(codeError('2X', { editing: true, check: null })).toBeNull();
    expect(codeError('MICO', { editing: false, check: null, serverError: 'The code MICO is already used.' })).toBe('The code MICO is already used.');
  });
});

describe('before saving', () => {
  it('needs a name, and for a new project a well-formed free code', () => {
    expect(checkDraft({ ...draftOf(null), name: ' ', code: '' }, { editing: false, check: null })).toEqual({ name: 'Give the project a name.', code: 'A project needs a code.' });
    expect(checkDraft({ ...draftOf(null), name: 'X', code: 'MICO' }, { editing: false, check: { code: 'MICO', valid: true, available: false } })).toEqual({ code: 'MICO is already used by another project.' });
    expect(checkDraft({ ...draftOf(project()), code: '' }, { editing: true, check: null })).toEqual({});
  });

  it('sends a new project’s details, leaving out what is empty', () => {
    expect(createBody({ ...draftOf(null), name: ' Rig ', code: 'RIG', number: ' ', clientName: ' PDO ', description: '', ownerId: '' })).toEqual({
      code: 'RIG',
      name: 'Rig',
      clientName: 'PDO',
      status: 'PLANNING',
      priority: 'NORMAL',
      ownerId: null,
      icon: null,
      color: '#8B1E1E',
    });
    expect(createBody({ ...draftOf(null), name: 'Rig', code: 'RIG', number: 'PDO-14', description: ' Scope ' })).toMatchObject({ number: 'PDO-14', description: 'Scope' });
  });

  it('sends only what changed for an edit (never the code)', () => {
    const before = draftOf(project());
    expect(projectChanges(before, before)).toEqual({});
    expect(projectChanges(before, { ...before, name: 'Rig 2 ', number: 'N-1', clientName: '', ownerId: '', color: '#2e7d53', icon: null, code: 'NEW' })).toEqual({ name: 'Rig 2', number: 'N-1', clientName: '', ownerId: null, icon: null });
    expect(projectChanges({ ...before, number: 'N-1' }, { ...before, number: ' ' })).toEqual({ number: null });
  });

  it('offers the clients other projects already have, matching what is typed', () => {
    const projects = [project({ clientName: 'PDO' }), project({ clientName: ' Petroleum Development Oman ' }), project({ clientName: 'OQ' }), project({ clientName: null }), project({ clientName: 'pdo' })];
    expect(clientSuggestions(projects, '')).toEqual(['OQ', 'PDO', 'Petroleum Development Oman']);
    expect(clientSuggestions(projects, 'pe')).toEqual(['Petroleum Development Oman']);
    expect(clientSuggestions(projects, 'PDO')).toEqual([]);
    expect(clientSuggestions(projects, 'o').length).toBeLessThanOrEqual(6);
  });

  it('knows when there is something to lose', () => {
    const d = draftOf(project());
    expect(isDirty(d, d, { kind: 'keep' })).toBe(false);
    expect(isDirty(d, { ...d, name: 'X' }, { kind: 'keep' })).toBe(true);
    expect(isDirty(d, d, { kind: 'remove' })).toBe(true);
  });
});

describe('the picture', () => {
  it('takes a PNG, JPG or WebP of up to 2 MB, and says plainly what is wrong', () => {
    expect(PICTURE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(pictureProblem({ name: 'logo.png', mimeType: 'image/png', size: 300_000 })).toBeNull();
    expect(pictureProblem({ name: 'logo.webp', mimeType: null, size: undefined })).toBeNull();
    expect(pictureProblem({ name: 'logo.gif', mimeType: 'image/gif', size: 1000 })).toBe('“logo.gif” can’t be used — use a PNG, JPG or WebP image.');
    expect(pictureProblem({ name: 'photo.heic', mimeType: 'image/heic', size: 1000 })).toBe('“photo.heic” can’t be used — use a PNG, JPG or WebP image.');
    expect(pictureProblem({ name: 'big.jpg', mimeType: 'image/jpeg', size: 3.5 * 1024 * 1024 })).toBe('“big.jpg” is 3.5 MB — project pictures can be up to 2 MB.');
    expect(pictureProblem({ name: 'empty.png', mimeType: 'image/png', size: 0 })).toBe('“empty.png” is empty.');
  });

  it('is sent as the multipart part, named when the picker gives no name', () => {
    expect(picturePart({ uri: 'file:///c/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg' })).toEqual({ uri: 'file:///c/a.jpg', name: 'a.jpg', type: 'image/jpeg' });
    expect(picturePart({ uri: 'content://x/1', name: null, mimeType: 'image/png' })).toEqual({ uri: 'content://x/1', name: 'project.png', type: 'image/png' });
  });

  it('removing a picture chosen but not yet saved just forgets it', () => {
    const fresh = { kind: 'new' as const, part: { uri: 'u', name: 'a.png', type: 'image/png' } };
    expect(pictureChoiceFor({ kind: 'remove' }, fresh, null)).toEqual({ kind: 'keep' });
    expect(pictureChoiceFor({ kind: 'remove' }, fresh, '/uploads/old.png')).toEqual({ kind: 'remove' });
    expect(pictureChoiceFor(fresh, { kind: 'keep' }, null)).toEqual(fresh);
  });
});

describe('saving', () => {
  function fakeApi(over: Partial<ProjectSaveApi> = {}) {
    const calls: unknown[][] = [];
    const api: ProjectSaveApi = {
      create: async (input, key) => {
        calls.push(['create', input, key]);
        return project({ id: 'new', code: input.code, name: input.name, imageUrl: null });
      },
      update: async (id, patch) => {
        calls.push(['update', id, patch]);
        return project({ id, ...patch } as Partial<ApiProject>);
      },
      uploadImage: async (id, part) => {
        calls.push(['upload', id, part.name]);
        return project({ id, imageUrl: '/uploads/p/new.png' });
      },
      removeImage: async (id) => {
        calls.push(['remove', id]);
        return project({ id, imageUrl: null });
      },
      ...over,
    };
    return { api, calls };
  }
  const part = { uri: 'file:///c/logo.png', name: 'logo.png', type: 'image/png' };

  it('creates the project with its key, then adds its picture', async () => {
    const { api, calls } = fakeApi();
    const out = await saveProject(api, { saved: null, initial: draftOf(null), draft: { ...draftOf(null), name: 'Rig', code: 'RIG' }, picture: { kind: 'new', part }, idempotencyKey: 'k1' });
    expect(out).toMatchObject({ kind: 'done', project: { id: 'new', imageUrl: '/uploads/p/new.png' } });
    expect(calls.map((c) => c[0])).toEqual(['create', 'upload']);
    expect(calls[0]![2]).toBe('k1');
  });

  it('says the code is taken when the server says so, keeping what was typed', async () => {
    const { api } = fakeApi({ create: async () => Promise.reject(new ApiError(409, 'DUPLICATE_PROJECT_CODE', 'The code RIG is already used by another project (or a deleted one).')) });
    const out = await saveProject(api, { saved: null, initial: draftOf(null), draft: { ...draftOf(null), name: 'Rig', code: 'RIG' }, picture: { kind: 'keep' }, idempotencyKey: 'k1' });
    expect(out).toEqual({ kind: 'code-taken', message: 'The code RIG is already used by another project (or a deleted one).', retryable: false });
  });

  it('a create still running elsewhere is not a taken code', async () => {
    const { api } = fakeApi({ create: async () => Promise.reject(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The original request is still being processed. Retry shortly.')) });
    const out = await saveProject(api, { saved: null, initial: draftOf(null), draft: { ...draftOf(null), name: 'Rig', code: 'RIG' }, picture: { kind: 'keep' }, idempotencyKey: 'k1' });
    expect(out).toEqual({ kind: 'failed', message: 'Couldn’t create the project. It is still being saved — wait a moment, then try again.', retryable: true });
  });

  it('offline or without an answer, keeps the key for the next try and says so', async () => {
    const offline = fakeApi({ create: async () => Promise.reject(new NetworkError('offline')) });
    expect(await saveProject(offline.api, { saved: null, initial: draftOf(null), draft: { ...draftOf(null), name: 'Rig', code: 'RIG' }, picture: { kind: 'keep' }, idempotencyKey: 'k1' })).toEqual({
      kind: 'failed',
      message: 'Couldn’t create the project. You’re offline — try again when you’re connected.',
      retryable: true,
    });
    const slow = fakeApi({ create: async () => Promise.reject(new NetworkError('slow', { timedOut: true })) });
    expect(await saveProject(slow.api, { saved: null, initial: draftOf(null), draft: { ...draftOf(null), name: 'Rig', code: 'RIG' }, picture: { kind: 'keep' }, idempotencyKey: 'k1' })).toEqual({
      kind: 'failed',
      message: 'Couldn’t create the project. The server didn’t answer in time — try again; it won’t be created twice.',
      retryable: true,
    });
    const refused = fakeApi({ create: async () => Promise.reject(new ApiError(400, 'VALIDATION', 'Use a colour like #8B1E1E.')) });
    expect(await saveProject(refused.api, { saved: null, initial: draftOf(null), draft: { ...draftOf(null), name: 'Rig', code: 'RIG' }, picture: { kind: 'keep' }, idempotencyKey: 'k1' })).toEqual({
      kind: 'failed',
      message: 'Couldn’t create the project. Use a colour like #8B1E1E.',
      retryable: false,
    });
  });

  it('a picture that fails after the project is created leaves the project to edit, with the website’s words', async () => {
    const { api } = fakeApi({ uploadImage: async () => Promise.reject(new ApiError(400, 'VALIDATION', 'Images can be up to 2 MB; this one is 3 MB.')) });
    const out = await saveProject(api, { saved: null, initial: draftOf(null), draft: { ...draftOf(null), name: 'Rig', code: 'RIG' }, picture: { kind: 'new', part }, idempotencyKey: 'k1' });
    expect(out).toMatchObject({ kind: 'partly', project: { id: 'new' }, detailsSaved: true });
    expect((out as { message: string }).message).toBe('The project was created, but its picture wasn’t saved: Images can be up to 2 MB; this one is 3 MB. Try again, or remove the picture and save.');
  });

  it('an edit sends only the changes, then the picture; nothing changed sends nothing', async () => {
    const saved = project();
    const before = draftOf(saved);
    const a = fakeApi();
    expect(await saveProject(a.api, { saved, initial: before, draft: { ...before, name: 'Rig 2' }, picture: { kind: 'remove' }, idempotencyKey: 'k1' })).toMatchObject({ kind: 'done' });
    expect(a.calls).toEqual([['update', 'p1', { name: 'Rig 2' }], ['remove', 'p1']]);
    const b = fakeApi();
    expect(await saveProject(b.api, { saved, initial: before, draft: before, picture: { kind: 'keep' }, idempotencyKey: 'k1' })).toEqual({ kind: 'done', project: saved });
    expect(b.calls).toEqual([]);
  });

  it('says which part of an edit wasn’t saved', async () => {
    const saved = project();
    const before = draftOf(saved);
    const failing = { uploadImage: async () => Promise.reject(new NetworkError('offline')) };
    const both = await saveProject(fakeApi(failing).api, { saved, initial: before, draft: { ...before, name: 'Rig 2' }, picture: { kind: 'new', part }, idempotencyKey: 'k1' });
    expect(both).toMatchObject({ kind: 'partly', detailsSaved: true, message: 'The other changes were saved, but the picture wasn’t: You’re offline — try again when you’re connected.' });
    const only = await saveProject(fakeApi(failing).api, { saved, initial: before, draft: before, picture: { kind: 'new', part }, idempotencyKey: 'k1' });
    expect(only).toMatchObject({ kind: 'partly', detailsSaved: false, message: 'Couldn’t save the picture. You’re offline — try again when you’re connected.' });
    const details = await saveProject(fakeApi({ update: async () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'You do not have permission.')) }).api, { saved, initial: before, draft: { ...before, name: 'X' }, picture: { kind: 'keep' }, idempotencyKey: 'k1' });
    expect(details).toEqual({ kind: 'failed', message: 'Couldn’t save the changes. You do not have permission.', retryable: false });
  });
});
