import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, NetworkError } from './api-client';
import { BOARD_TEXT, moveCard, moveRefusedText, reorderCards } from './board-writes';
import { moveToStatus } from './all-board';
import { findPlaces, placeChoices } from './board-move';
import { COLUMN_TEXT, emptyBoardText, manageColumnsGate } from './board-columns';

const kept = (e: Error) => Object.assign(e, { [Symbol.for('mico360.keptOnPhone')]: true });
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('board review fixes (4b review #8–#13)', () => {
  const plan = { index: 1, orderedIds: ['a', 'x', 'b'], at: 0.5 };

  it('#8 a move kept on this phone says its place in the column may change when it syncs (the replay sends its place by number)', async () => {
    const offline = { move: vi.fn(async () => Promise.reject(kept(new NetworkError('Network request failed.')))), reorder: vi.fn(async () => {}) };
    expect(await moveCard(offline, { id: 'x', toColumnId: 'c2', plan })).toEqual({
      kind: 'kept',
      message: `Saved on this phone — will sync when you’re online. ${BOARD_TEXT.placeMayChange}`,
    });
    expect(BOARD_TEXT.placeMayChange).toBe('Its place in the column may change when it syncs.');
    // Alone in its column, there is no place to lose.
    const alone = await moveCard(offline, { id: 'x', toColumnId: 'c2', plan: { index: 0, orderedIds: ['x'], at: 0 } });
    expect(alone).toEqual({ kind: 'kept', message: 'Saved on this phone — will sync when you’re online.' });
  });

  it('#9 a refused move says the server’s reason (a 403 or a rule), as the old board did', async () => {
    const forbidden = new ApiError(403, 'FORBIDDEN', 'You do not have access to this project.');
    expect(moveRefusedText(forbidden)).toBe('Couldn’t move that task — it was put back. You do not have access to this project.');
    expect(moveRefusedText(new ApiError(500, 'ERROR', 'Request failed (500)'))).toBe(BOARD_TEXT.moveRefused);
    expect(moveRefusedText(new Error('boom'))).toBe(BOARD_TEXT.moveRefused);
    const refusing = { move: vi.fn(async () => Promise.reject(forbidden)), reorder: vi.fn(async () => Promise.reject(forbidden)) };
    expect(await moveCard(refusing, { id: 'x', toColumnId: 'c2', plan })).toEqual({ kind: 'refused', message: moveRefusedText(forbidden) });
    expect(await reorderCards(refusing, { columnId: 'c2', orderedIds: ['x', 'a'] })).toEqual({ kind: 'put-back', message: moveRefusedText(forbidden) });
    expect(await moveToStatus(() => Promise.reject(forbidden), { id: 'x', columnId: 'd' })).toEqual({ kind: 'refused', message: moveRefusedText(forbidden) });
  });

  it('#10 “saved on this phone” is shown, not only spoken (both boards)', () => {
    for (const p of ['screens/BoardScreen.tsx', 'screens/AllBoardScreen.tsx']) {
      expect(src(p), p).toMatch(/if \(out\.kind === 'kept'\) notice\(out\.message\);/);
    }
    expect(src('screens/NewTaskScreen.tsx')).toMatch(/import \{ notice \} from '\.\.\/components\/notice';/);
  });

  it('#11 the places in a column are a virtualized list with a search, read out one by one', () => {
    const cards = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, key: `MICO-${i}`, title: i === 42 ? 'Fix the pump' : `Task ${i}` }));
    const places = placeChoices(cards, 'none');
    expect(findPlaces(places, 'pump').map((p) => p.label)).toEqual(['After MICO-42 · Fix the pump']);
    expect(findPlaces(places, ' mico-499 ')).toEqual([]); // the last card is “At the bottom”
    expect(findPlaces(places, '').length).toBe(places.length);
    const sheet = src('components/board/MoveCardSheet.tsx');
    expect(sheet).toMatch(/<FlatList\s+data=\{shownPlaces\}/);
    expect(sheet).toMatch(/placeholder="Find a card"/);
    expect(sheet).toMatch(/scroll=\{!dest\}/);
    expect(src('components/meeting/sheet-kit.tsx')).toMatch(/scroll = true/);
  });

  it('#12 a card’s due day uses a formatter made once, not one per card', () => {
    const board = src('lib/board.ts');
    expect(board).not.toMatch(/new Intl\.DateTimeFormat/);
    expect(board).toMatch(/dateFormat\('en-US', \{ month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' \}\)/);
  });

  it('#13 an empty board says what is really the matter; Manage columns offline says it needs a connection', () => {
    expect(emptyBoardText({ columns: 0, canManage: true })).toEqual({ title: 'No columns', subtitle: 'This project has no board columns yet. Add one in Manage columns.' });
    expect(emptyBoardText({ columns: 0, canManage: false })).toEqual({ title: 'No columns', subtitle: 'This project has no board columns yet.' });
    expect(emptyBoardText({ columns: 3, canManage: true })).toEqual({ title: 'All columns are hidden', subtitle: 'Every column of this project is switched off. Turn one on in Manage columns.' });
    expect(emptyBoardText({ columns: 3, canManage: false })).toEqual({ title: 'All columns are hidden', subtitle: 'Every column of this project is switched off.' });
    const admin = { id: 'u1', roles: ['ADMIN'] };
    const member = { id: 'u2', roles: ['EMPLOYEE'] };
    expect(manageColumnsGate(admin, [], { membersKnown: false })).toBe('ok');
    expect(manageColumnsGate(member, [{ id: 'u2', role: 'MANAGER' }], { membersKnown: true })).toBe('ok');
    expect(manageColumnsGate(member, [{ id: 'u2', role: 'MEMBER' }], { membersKnown: true })).toBe('refused');
    expect(manageColumnsGate(member, [], { membersKnown: false })).toBe('needs-connection');
    expect(COLUMN_TEXT.needsConnection).toBe('Needs a connection to check who can manage columns. Check your connection and try again.');
    expect(src('screens/BoardColumnsScreen.tsx')).toMatch(/manageColumnsGate\(user, membersQ\.data \?\? \[\], \{ membersKnown: !!membersQ\.data \}\)/);
    expect(src('screens/BoardScreen.tsx')).toMatch(/emptyBoardText\(\{ columns: columnsQ\.data\?\.length \?\? 0, canManage \}\)/);
  });
});
