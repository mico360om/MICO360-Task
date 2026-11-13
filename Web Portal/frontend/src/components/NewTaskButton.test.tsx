import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { NewTaskButton } from './NewTaskButton';

// The form itself is tested on its own (NewTaskModal.test): here only whether it opens.
vi.mock('./NewTaskModal', () => ({ NewTaskModal: () => <div role="dialog" aria-label="New task" /> }));

function Address() {
  const l = useLocation();
  return <output data-testid="address">{`${l.pathname}${l.search}`}</output>;
}

function at(url: string, props: Parameters<typeof NewTaskButton>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <NewTaskButton {...props} />
      <Address />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

// Installable website (13 Nov): the installed app's "New task" shortcut opens /my-tasks?new=task — the
// header's New Task form opens on arrival, and the address is tidied (Back or a reload won't open it again).
describe('New task from the address (the installed app’s shortcut)', () => {
  it('the header’s button opens the form for ?new=task and drops it from the address', () => {
    at('/my-tasks?new=task&x=1', { openFromAddress: true });
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByTestId('address')).toHaveTextContent('/my-tasks?x=1');
  });

  it('only the button asked to (one form), and never for a page’s own ?new=1', () => {
    at('/my-tasks?new=task');
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    at('/projects?new=1', { openFromAddress: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('address')).toHaveTextContent('/projects?new=1');
  });
});
