import { describe, it, expect } from 'vitest';
import { createMicoAiService, type MicoAiModel } from './mico-ai-service';
import { createMemoryMicoAiRepository } from './mico-ai-repository';
import { createMicoAiTools } from './mico-ai-tools';
import { createMicoAiActions } from './mico-ai-actions';
import { createFakeWorld } from './mico-ai-actions.fixture';
import { company, NOW, OMAR, SARA } from './mico-ai-data.fixture';
import type { ModelRequest } from './mico-ai-loop';
import type { ProposalView } from './mico-ai-actions-types';

// The service around MICO AI's actions: a proposal is stored with its answer, Confirm and Undo act
// on that stored card (never on what the page sends, apart from the person's own edits), at most once.

type Reply = unknown | ((req: ModelRequest) => unknown);
function setup(replies: Reply[], opts: { now?: () => Date } = {}) {
  const repo = createMemoryMicoAiRepository(() => NOW);
  const world = createFakeWorld(company());
  let clock = opts.now ?? (() => NOW);
  const now = () => clock();
  let i = 0;
  const requests: ModelRequest[] = [];
  const model: MicoAiModel = {
    ready: async () => true,
    startQuestion: () => undefined,
    async chat(req) {
      requests.push(req as ModelRequest);
      const r = replies[Math.min(i++, replies.length - 1)];
      const out = typeof r === 'function' ? (r as (q: ModelRequest) => unknown)(req as ModelRequest) : r;
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  const audit: Array<Record<string, unknown>> = [];
  const svc = createMicoAiService({
    repo,
    tools: createMicoAiTools({ data: world.read, timeZone: 'Asia/Muscat', now }),
    actions: createMicoAiActions({ data: world.read, port: world.port, timeZone: 'Asia/Muscat', now }),
    model,
    audit: { record: async (e) => void audit.push(e as Record<string, unknown>) },
    timeZone: 'Asia/Muscat',
    now,
  });
  return { svc, repo, world, requests, audit, setNow: (f: () => Date) => (clock = f) };
}

const propose = (changes: Array<Record<string, unknown>>, text = 'Here are the changes. Check them, then confirm.') => ({ action: 'propose', text, changes });
const twoTasks = propose([
  { type: 'create_task', title: 'Replace the gauge', project: 'RIG', assignees: ['Sara'], due: 'tuesday' },
  { type: 'create_task', title: 'Check the valve', project: 'RIG' },
]);

async function asked(s: ReturnType<typeof setup>, viewer = OMAR, text = 'Make tasks for the failed items') {
  const chat = await s.svc.createChat(viewer, {});
  const { answer } = await s.svc.ask(viewer, chat.id, text);
  await s.svc.whenDone(answer.id);
  return { chatId: chat.id, messageId: answer.id, message: await s.svc.getMessage(viewer, chat.id, answer.id) };
}
const card = (m: { answer?: { proposal?: ProposalView } }) => m.answer!.proposal!;

describe('MICO AI service: a proposal is a card kept with its answer', () => {
  it('the answer shows the card, checked by the server, and nothing has changed yet', async () => {
    const s = setup([twoTasks]);
    const { message, messageId } = await asked(s);
    expect(message).toMatchObject({ status: 'done', text: 'Here are the changes. Check them, then confirm.', answer: { kind: 'proposal' } });
    const p = card(message);
    expect(p).toMatchObject({ status: 'proposed', sendInvites: true, hasMeetings: false, confirmedAt: null, undoUntil: null, canUndo: false, note: null });
    expect(p.items.map((x) => [x.id, x.type, x.result, x.undo])).toEqual([
      ['c1', 'create_task', null, null],
      ['c2', 'create_task', null, null],
    ]);
    expect(s.world.calls).toEqual([]);
    expect(s.repo.proposals).toHaveLength(1);
    expect(s.repo.proposals[0]!.messageId).toBe(messageId);
    // The message keeps only the card's id; the card itself (with what Undo needs) is stored apart.
    expect(JSON.stringify(s.repo.messages.find((m) => m.id === messageId)!.content)).not.toContain('Replace the gauge');
    // Searching the chats finds the changes' words.
    expect(s.repo.messages.find((m) => m.id === messageId)!.text).toContain('Replace the gauge');
  });

  it('the card is there when the chat is opened again (a reload), and in an older page of messages', async () => {
    const s = setup([twoTasks]);
    const { chatId } = await asked(s);
    const opened = await s.svc.getChat(OMAR, chatId);
    expect(card(opened.messages.at(-1)!).items).toHaveLength(2);
  });

  it('the next question is told what was proposed and what became of it', async () => {
    const s = setup([twoTasks, { action: 'answer', text: 'Done.' }]);
    const { chatId, messageId } = await asked(s);
    await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: true }, { id: 'c2', include: false }] }, { ip: null });
    const { answer } = await s.svc.ask(OMAR, chatId, 'What did you do?');
    await s.svc.whenDone(answer.id);
    const prompt = s.requests.at(-1)!.prompt;
    expect(prompt).toContain('Proposed changes');
    expect(prompt).toContain('Replace the gauge');
    expect(prompt).toMatch(/confirmed: 1 done, 1 skipped/);
  });

  it('a clarifying question from the server: "Which Omar do you mean?" with both as quick replies', async () => {
    const s = setup([propose([{ type: 'create_task', title: 'X', project: 'RIG', assignees: ['Omar'] }])]);
    s.world.data.people.push({ id: 'u-omar2', firstName: 'Omar', lastName: 'Khan', username: 'omar.k', active: true });
    const { message } = await asked(s, SARA);
    expect(message).toMatchObject({ text: 'Which Omar do you mean?', answer: { kind: 'clarify', options: ['Omar Khan (omar.k)', 'Omar Said (omar)'] } });
    expect(s.repo.proposals).toHaveLength(0);
  });
});

describe('MICO AI service: Confirm', () => {
  it('carries out the stored card with the person’s edits, and keeps the result on it', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    const after = await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: true, edits: { title: 'Replace the north gauge' } }, { id: 'c2', include: true }] }, { ip: '10.1.1.1' });
    const p = card(after);
    expect(p.status).toBe('done');
    expect(p.items.map((x) => x.result?.status)).toEqual(['done', 'done']);
    expect(p.items[0]).toMatchObject({ fields: { title: 'Replace the north gauge' } });
    expect(p.confirmedAt).toBe(NOW.toISOString());
    expect(p.undoUntil).toBe(new Date(NOW.getTime() + 15 * 60_000).toISOString());
    expect(p.canUndo).toBe(true);
    // What Undo needs stays on the server.
    expect(JSON.stringify(after)).not.toContain('"undo":{"kind"');
    expect(JSON.stringify(after)).not.toContain('activity');
    expect(s.world.data.tasks.find((t) => t.title === 'Replace the north gauge')).toBeTruthy();
    // Reopened later, the card shows the same.
    expect(card(await s.svc.getMessage(OMAR, chatId, messageId)).items.map((x) => x.result?.status)).toEqual(['done', 'done']);
  });

  it('a double click (two confirms at once) or a retry never makes the tasks twice', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    const body = { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] };
    const [a, b] = await Promise.all([s.svc.confirm(OMAR, chatId, messageId, body, { ip: null }), s.svc.confirm(OMAR, chatId, messageId, body, { ip: null })]);
    const again = await s.svc.confirm(OMAR, chatId, messageId, body, { ip: null });
    expect(s.world.calls.filter((c) => c.startsWith('createTask'))).toHaveLength(2);
    expect(card(again).status).toBe('done');
    // The second sees the first one's card (still being carried out, or done); neither does it again.
    for (const x of [a, b]) expect(['confirming', 'done']).toContain(card(x).status);
  });

  it('content sent by the page other than the person’s edits is ignored: the stored card is what is carried out', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    const forged = { items: [{ id: 'c1', include: true, edits: { projectId: 'p-falcon' } }, { id: 'c9', include: true, edits: { title: 'Injected' } }] };
    const p = card(await s.svc.confirm(OMAR, chatId, messageId, forged, { ip: null }));
    expect(p.items.map((x) => x.id)).toEqual(['c1', 'c2']);
    expect(p.items[0]!.result).toMatchObject({ status: 'refused', message: 'Pick a project you can see.' });
    // Not listed: as the card proposed it.
    expect(p.items[1]!.result!.status).toBe('done');
    expect(s.world.data.tasks.some((t) => t.title === 'Injected')).toBe(false);
  });

  it('Cancel: nothing changes, and it can’t be confirmed afterwards', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    expect(card(await s.svc.cancel(OMAR, chatId, messageId)).status).toBe('cancelled');
    expect(card(await s.svc.confirm(OMAR, chatId, messageId, { items: [] }, { ip: null })).status).toBe('cancelled');
    expect(s.world.calls).toEqual([]);
  });

  it('someone else’s chat, or an answer without a card, is not found', async () => {
    const s = setup([twoTasks, { action: 'answer', text: 'Plain.' }]);
    const { chatId, messageId } = await asked(s);
    await expect(s.svc.confirm(SARA, chatId, messageId, { items: [] }, { ip: null })).rejects.toMatchObject({ status: 404 });
    const { answer } = await s.svc.ask(OMAR, chatId, 'And?');
    await s.svc.whenDone(answer.id);
    await expect(s.svc.confirm(OMAR, chatId, answer.id, { items: [] }, { ip: null })).rejects.toMatchObject({ status: 404 });
  });

  it('a confirm cut off by a restart is settled: what was done stays done, the rest says it was interrupted', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    const p = s.repo.proposals[0]!;
    await s.repo.moveProposal(p.id, ['PROPOSED'], 'CONFIRMING');
    await s.repo.updateProposal(p.id, { results: { c1: { status: 'done', message: null, link: { label: 'RIG-35', url: '?task=x' } } } });
    s.repo.proposals[0]!.updatedAt = new Date(NOW.getTime() - 10 * 60_000);
    const view = card(await s.svc.getMessage(OMAR, chatId, messageId));
    expect(view.status).toBe('done');
    expect(view.items.map((x) => x.result?.status)).toEqual(['done', 'failed']);
    expect(view.items[1]!.result!.message).toMatch(/interrupted/);
  });

  it('a change cut off part-way (started, not known to be done) reads “may have been made — check it”, with its link', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    const p = s.repo.proposals[0]!;
    await s.repo.moveProposal(p.id, ['PROPOSED'], 'CONFIRMING');
    await s.repo.updateProposal(p.id, { results: { c1: { status: 'started', message: null, link: { label: 'RIG-9', url: '?task=t9' } } } });
    s.repo.proposals[0]!.updatedAt = new Date(NOW.getTime() - 10 * 60_000);
    const view = card(await s.svc.getMessage(OMAR, chatId, messageId));
    expect(view.items[0]!.result).toEqual({ status: 'failed', message: 'This may have been made — check it.', link: { label: 'RIG-9', url: '?task=t9' } });
    expect(view.items[1]!.result).toEqual({ status: 'failed', message: 'This wasn’t made: the confirm was interrupted before it got here.', link: null });
  });

  it('the card carries the server’s clock, so the page’s Undo countdown doesn’t depend on the device’s', async () => {
    const s = setup([twoTasks]);
    const { message } = await asked(s);
    expect(card(message).serverNow).toBe(NOW.toISOString());
  });
});

describe('MICO AI service: asking again (Retry) never leaves two live cards', () => {
  it('Retry supersedes the unconfirmed card it replaces: only the new one can be confirmed', async () => {
    const s = setup([twoTasks, twoTasks]);
    const { chatId, messageId: first } = await asked(s);
    const { answer } = await s.svc.ask(OMAR, chatId, 'Make tasks for the failed items', { ip: null, retryOf: first });
    await s.svc.whenDone(answer.id);
    expect(card(await s.svc.getMessage(OMAR, chatId, first)).status).toBe('superseded');
    expect(card(await s.svc.confirm(OMAR, chatId, first, { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] }, { ip: null })).status).toBe('superseded');
    expect(s.world.calls).toEqual([]);
    expect(card(await s.svc.confirm(OMAR, chatId, answer.id, { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] }, { ip: null })).status).toBe('done');
    expect(s.world.calls.filter((c) => c.startsWith('createTask'))).toHaveLength(2);
  });

  it('the same question asked again (without Retry) supersedes the unconfirmed card too; a confirmed card is left alone', async () => {
    const s = setup([twoTasks, twoTasks, twoTasks]);
    const { chatId, messageId: first } = await asked(s);
    const second = (await s.svc.ask(OMAR, chatId, 'Make tasks for the failed items')).answer.id;
    await s.svc.whenDone(second);
    expect(card(await s.svc.getMessage(OMAR, chatId, first)).status).toBe('superseded');
    await s.svc.confirm(OMAR, chatId, second, { items: [{ id: 'c1', include: true }, { id: 'c2', include: false }] }, { ip: null });
    const third = (await s.svc.ask(OMAR, chatId, 'Make tasks for the failed items')).answer.id;
    await s.svc.whenDone(third);
    expect(card(await s.svc.getMessage(OMAR, chatId, second)).status).toBe('done');
  });

  it('a superseded card has nothing to undo, and the model is told it was replaced', async () => {
    const s = setup([twoTasks, twoTasks, { action: 'answer', text: 'ok' }]);
    const { chatId, messageId: first } = await asked(s);
    const second = (await s.svc.ask(OMAR, chatId, 'Make tasks for the failed items', { ip: null, retryOf: first })).answer.id;
    await s.svc.whenDone(second);
    await expect(s.svc.undo(OMAR, chatId, first, { ip: null })).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' });
    const { answer } = await s.svc.ask(OMAR, chatId, 'What now?');
    await s.svc.whenDone(answer.id);
    expect(s.requests.at(-1)!.prompt).toMatch(/replaced by a newer answer/);
  });
});

describe('MICO AI service: an Undo cut off part-way', () => {
  it('says “not undone” for every change it didn’t reach, and “may have been put back” for one it was on', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] }, { ip: null });
    const p = s.repo.proposals[0]!;
    await s.repo.moveProposal(p.id, ['DONE'], 'UNDOING');
    await s.repo.updateProposal(p.id, { undo: { c2: { status: 'started', message: null } } });
    s.repo.proposals[0]!.updatedAt = new Date(NOW.getTime() - 10 * 60_000);
    const view = card(await s.svc.getMessage(OMAR, chatId, messageId));
    expect(view.status).toBe('undone');
    expect(view.items.map((x) => x.undo)).toEqual([
      { status: 'failed', message: 'Undo was interrupted before it got to this, so it was left as it is.' },
      { status: 'failed', message: 'This may have been put back — check it.' },
    ]);
  });

  it('an Undo that fails in this process still gives each change it didn’t reach a line', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] }, { ip: null });
    const realUpdate = s.repo.updateProposal.bind(s.repo);
    let n = 0;
    s.repo.updateProposal = async (id, patch, onlyIf) => {
      if (patch.undo && ++n === 2) throw new Error('database went away');
      return realUpdate(id, patch, onlyIf);
    };
    const view = card(await s.svc.undo(OMAR, chatId, messageId, { ip: null }));
    expect(view.status).toBe('undone');
    expect(view.items.every((x) => x.undo && x.undo.status !== 'started')).toBe(true);
    expect(view.items.some((x) => x.undo?.message === 'Undo was interrupted before it got to this, so it was left as it is.' || x.undo?.message === 'This may have been put back — check it.')).toBe(true);
  });
});


describe('MICO AI service: Undo', () => {
  it('puts the changes back within 15 minutes; a second Undo changes nothing more', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] }, { ip: null });
    s.setNow(() => new Date(NOW.getTime() + 14 * 60_000));
    const undone = card(await s.svc.undo(OMAR, chatId, messageId, { ip: null }));
    expect(undone.status).toBe('undone');
    expect(undone.items.map((x) => x.undo?.status)).toEqual(['undone', 'undone']);
    expect(undone.canUndo).toBe(false);
    const deletes = s.world.calls.filter((c) => c.startsWith('deleteCreatedTask'));
    expect(deletes).toHaveLength(2);
    await s.svc.undo(OMAR, chatId, messageId, { ip: null });
    expect(s.world.calls.filter((c) => c.startsWith('deleteCreatedTask'))).toHaveLength(2);
  });

  it('after 15 minutes Undo is closed', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] }, { ip: null });
    s.setNow(() => new Date(NOW.getTime() + 15 * 60_000 + 1000));
    expect(card(await s.svc.getMessage(OMAR, chatId, messageId)).canUndo).toBe(false);
    await expect(s.svc.undo(OMAR, chatId, messageId, { ip: null })).rejects.toMatchObject({ status: 409, code: 'UNDO_EXPIRED' });
    expect(s.world.calls.filter((c) => c.startsWith('deleteCreatedTask'))).toHaveLength(0);
  });

  it('nothing to undo before Confirm, or when nothing was made', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    await expect(s.svc.undo(OMAR, chatId, messageId, { ip: null })).rejects.toMatchObject({ status: 409, code: 'NOTHING_TO_UNDO' });
    await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: false }, { id: 'c2', include: false }] }, { ip: null });
    expect(card(await s.svc.getMessage(OMAR, chatId, messageId))).toMatchObject({ status: 'done', canUndo: false, undoUntil: null });
    await expect(s.svc.undo(OMAR, chatId, messageId, { ip: null })).rejects.toMatchObject({ status: 409, code: 'NOTHING_TO_UNDO' });
  });

  it('a change someone made since is left as it is, per change', async () => {
    const s = setup([twoTasks]);
    const { chatId, messageId } = await asked(s);
    const done = card(await s.svc.confirm(OMAR, chatId, messageId, { items: [{ id: 'c1', include: true }, { id: 'c2', include: true }] }, { ip: null }));
    const first = s.world.data.tasks.find((t) => t.title === 'Replace the gauge')!;
    s.world.touchTask(first.id, 'u-sara');
    const undone = card(await s.svc.undo(OMAR, chatId, messageId, { ip: null }));
    expect(undone.items.map((x) => x.undo)).toEqual([
      { status: 'refused', message: `Sara Ahmed changed ${done.items[0]!.result!.link!.label} since, so it was left as it is.` },
      { status: 'undone', message: `${done.items[1]!.result!.link!.label} was deleted.`, gone: true },
    ]);
  });
});
