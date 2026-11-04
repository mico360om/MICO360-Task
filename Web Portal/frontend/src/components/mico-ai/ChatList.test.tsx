import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatList } from './ChatList';

const chat = { id: 'c1', title: 'Overdue tasks', createdAt: '2026-11-04T08:00:00Z', updatedAt: '2026-11-04T08:00:00Z', lastMessageAt: '2026-11-04T08:00:00Z', match: null };

describe('MICO AI chat list: buttons a finger can hit (1.22 design pass)', () => {
  it('New chat, a chat and its "More for…" button are 44px on a touch screen', () => {
    render(
      <ChatList chats={[chat]} activeId={null} query="" onQuery={vi.fn()} onOpen={vi.fn()} onNew={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} timeZone="Asia/Muscat" now={new Date('2026-11-04T09:00:00Z')} />,
    );
    expect(screen.getByRole('button', { name: /New chat/ }).className).toContain('[@media(pointer:coarse)]:!min-h-11');
    expect(screen.getByRole('button', { name: /^Overdue tasks/ }).className).toContain('[@media(pointer:coarse)]:!min-h-11');
    const more = screen.getByRole('button', { name: 'More for Overdue tasks' }).className;
    expect(more).toContain('[@media(pointer:coarse)]:h-11');
    expect(more).toContain('[@media(pointer:coarse)]:w-11');
  });
});
