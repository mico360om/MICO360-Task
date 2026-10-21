import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the board screen (4b)', () => {
  const screen = src('screens/BoardScreen.tsx');

  // A column is drawn by the shared column view (the All projects board uses it too — 4c).
  const columnView = src('components/board/BoardColumnView.tsx');

  it('lays its columns and their cards out as virtualized lists, not mapped scroll views', () => {
    expect(screen).toMatch(/<FlatList\s+horizontal\s+data=\{board\}/);
    expect(screen).toMatch(/<BoardColumnView id=\{column\.id\} name=\{column\.name\} color=\{column\.color\} cards=\{cards\}/);
    expect(columnView).toMatch(/<FlatList\s+data=\{cards\}/);
    expect(screen).not.toMatch(/ScrollView/);
    expect(columnView).not.toMatch(/ScrollView/);
  });

  it('draws each column in its own colour (the website’s column.color), with its count and “+”', () => {
    expect(columnView).toMatch(/s\.columnStripe, \{ backgroundColor: color \}/);
    expect(columnView).toMatch(/s\.dot, \{ backgroundColor: color \}/);
    expect(screen).not.toMatch(/categoryColorOf/);
    expect(columnView).toMatch(/accessibilityLabel=\{`Add a task to \$\{name\}`\}/);
  });

  it('moves cards through the task write path, then the column’s order, as the website does', () => {
    expect(screen).toMatch(/move\.mutateAsync\(\{ id, columnId, position, at \}\)/);
    expect(screen).toMatch(/reorder\.mutateAsync\(\{ columnId, orderedIds \}\)/);
    expect(screen).toMatch(/moveCard\(writes, \{ id: task\.id, toColumnId, plan \}\)/);
    expect(screen).toMatch(/reorderCards\(writes, \{ columnId, orderedIds \}\)/);
  });

  it('picks the board’s day from a calendar, and offers Manage columns only to those the server lets manage the project', () => {
    expect(screen).toMatch(/<BoardDayBar boardDate=\{boardDate\} todayKey=\{todayKey\}/);
    expect(src('components/board/BoardDayBar.tsx')).toMatch(/<DayPicker/);
    expect(screen).toMatch(/const canManage = canManageProject\(user, membersQ\.data \?\? \[\]\);/);
    expect(screen).toMatch(/\{canManage \? \(/);
    expect(screen).toMatch(/navigation\.navigate\('BoardColumns', \{ projectId, projectName \}\)/);
  });

  it('a card can be placed with TalkBack: Move…, Move up and Move down are its actions', () => {
    const card = src('components/board/BoardCard.tsx');
    expect(card).toMatch(/\{ name: 'longpress', label: 'Move…' \}/);
    expect(card).toMatch(/\{ name: 'moveUp', label: 'Move up' \}/);
    expect(card).toMatch(/\{ name: 'moveDown', label: 'Move down' \}/);
    expect(card).toMatch(/accessibilityLabel=\{view\.label\}/);
  });

  it('a card’s faces come from this server only (one rule: serverFileHref)', () => {
    expect(screen).toMatch(/serverFileHref\(baseUrl, u\.avatarUrl\)/);
  });
});

describe('Manage columns (4b)', () => {
  const screen = src('screens/BoardColumnsScreen.tsx');
  it('is for those the server lets manage the project; every change goes through the column actions', () => {
    expect(screen).toMatch(/const gate = manageColumnsGate\(user, membersQ\.data \?\? \[\], \{ membersKnown: !!membersQ\.data \}\);/);
    expect(screen).toMatch(/gate === 'refused' \? <ErrorNote message=\{COLUMN_TEXT\.refused\} \/>/);
    for (const a of ['add', 'rename', 'recolour', 'setCategory', 'setEnabled', 'remove', 'move']) expect(screen, a).toMatch(new RegExp(`actions\\.${a}\\(`));
  });

  it('asks before deleting, and says that a column with tasks can’t be deleted', () => {
    expect(screen).toMatch(/Alert\.alert\('Delete column\?'/);
    expect(screen).toMatch(/A column that still has tasks can’t be deleted — move them to another column first\./);
  });
});

describe('a task’s due date is picked from a calendar in its details too (4b)', () => {
  it('the details’ due date uses the New task form’s day picker, not a typed date', () => {
    const details = src('components/task-detail/DetailsCard.tsx');
    expect(details).toMatch(/<DueDateField/);
    expect(details).not.toMatch(/accessibilityLabel="Due date, year-month-day"/);
    expect(src('components/task-form/DueDateField.tsx')).toMatch(/label = 'Due date \(optional\)'/);
  });
});
