import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskDrawer } from './TaskDrawer';
import type { ApiTask } from '../api/tasks';

const task: ApiTask = {
  id: 't1', key: 'MICO-1', title: 'Rig inspection', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO',
  position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '',
};

describe('TaskDrawer: external contacts', () => {
  it('shows the External contacts section with the task’s details, apart from the assignees and before the files', () => {
    render(
      <TaskDrawer task={task} checklist={[]} comments={[]} onClose={vi.fn()} externalContacts={<section aria-label="External contacts">contacts here</section>} />,
    );
    const contacts = screen.getByRole('region', { name: 'External contacts' });
    const files = screen.getByRole('region', { name: /Attachments|Files/ });
    expect(contacts.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no such section when it isn’t given one', () => {
    render(<TaskDrawer task={task} checklist={[]} comments={[]} onClose={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'External contacts' })).toBeNull();
  });
});
