import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef, type ReactNode } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShortcutProvider, useShortcut } from './ShortcutProvider';
import type { ShortcutAction } from '../../lib/shortcuts';

function wrap(ui: ReactNode, qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <ShortcutProvider>{ui}</ShortcutProvider>
    </QueryClientProvider>,
  );
}

/** Press a key on the focused element (or the page), the way a person would. */
function press(init: { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean }, target: Element = document.activeElement ?? document.body) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}
const N = { key: 'n', code: 'KeyN' };
const E = { key: 'e', code: 'KeyE' };
const CTRL_S = { key: 's', code: 'KeyS', ctrlKey: true };
const CTRL_ENTER = { key: 'Enter', code: 'Enter', ctrlKey: true };

function Page({ on, action = 'new', priority }: { on: () => void; action?: ShortcutAction; priority?: number }) {
  useShortcut(action, on, { priority });
  return null;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('page shortcuts', () => {
  it('runs the page’s action for a single key, and not while typing', () => {
    const onNew = vi.fn();
    wrap(
      <>
        <Page on={onNew} />
        <input aria-label="Name" />
      </>,
    );
    const e = press(N);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    screen.getByLabelText('Name').focus();
    press(N);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('prefers the page’s own action over the header’s', () => {
    const header = vi.fn();
    const page = vi.fn();
    wrap(
      <>
        <Page on={header} priority={0} />
        <Page on={page} />
      </>,
    );
    press(N);
    expect(page).toHaveBeenCalled();
    expect(header).not.toHaveBeenCalled();
  });

  it('ignores a key something else already handled', () => {
    const onNew = vi.fn();
    wrap(<Page on={onNew} />);
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...N });
    e.preventDefault();
    act(() => {
      document.body.dispatchEvent(e);
    });
    expect(onNew).not.toHaveBeenCalled();
  });

  it('leaves page actions alone while a dialog is open, except the dialog’s own', () => {
    const pageEdit = vi.fn();
    const drawerEdit = vi.fn();
    function Drawer() {
      const ref = useRef<HTMLDivElement>(null);
      useShortcut('edit', drawerEdit, { scope: ref });
      return (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="Task">
          <button type="button">Close</button>
        </div>
      );
    }
    wrap(
      <>
        <Page on={pageEdit} action="edit" />
        <Drawer />
      </>,
    );
    screen.getByRole('button', { name: 'Close' }).focus();
    press(E);
    expect(drawerEdit).toHaveBeenCalledTimes(1);
    expect(pageEdit).not.toHaveBeenCalled();
  });
});

describe('forms and dialogs', () => {
  function Dialog({ onSubmit, busy }: { onSubmit: () => void; busy?: boolean }) {
    return (
      <div role="dialog" aria-modal="true" aria-label="New project">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input aria-label="Project name" />
          <button type="submit" aria-disabled={busy || undefined}>
            Create
          </button>
        </form>
      </div>
    );
  }

  it('saves the dialog’s form with Ctrl+S and Ctrl+Enter, wherever focus is in it', () => {
    const onSubmit = vi.fn();
    wrap(<Dialog onSubmit={onSubmit} />);
    screen.getByLabelText('Project name').focus();
    const e = press(CTRL_S);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true); // not the browser's "Save page"
    screen.getByRole('button', { name: 'Create' }).focus();
    press(CTRL_ENTER);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('does not save twice while the first save is still running', () => {
    const onSubmit = vi.fn();
    wrap(<Dialog onSubmit={onSubmit} busy />);
    screen.getByLabelText('Project name').focus();
    const e = press(CTRL_S);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('saves the page form you’re in, or the page’s main form', () => {
    const profile = vi.fn();
    const settings = vi.fn();
    wrap(
      <>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            profile();
          }}
        >
          <input aria-label="First name" />
          <button type="submit">Save profile</button>
        </form>
        <form
          data-shortcut-save
          onSubmit={(e) => {
            e.preventDefault();
            settings();
          }}
        >
          <button type="submit">Save settings</button>
        </form>
      </>,
    );
    screen.getByLabelText('First name').focus();
    press(CTRL_S);
    expect(profile).toHaveBeenCalledTimes(1);
    (document.activeElement as HTMLElement).blur();
    press(CTRL_S, document.body);
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('leaves Ctrl+S to the browser when there is nothing to save', () => {
    wrap(<p>Nothing here</p>);
    expect(press(CTRL_S, document.body).defaultPrevented).toBe(false);
  });
});

describe('search, refresh and the list of shortcuts', () => {
  it('jumps to the page’s search box with /, else opens the main search', () => {
    const openSearch = vi.fn();
    function Search() {
      useShortcut('search', openSearch, { priority: 0 });
      return null;
    }
    const { rerender } = wrap(
      <>
        <Search />
        <input type="search" aria-label="Search meetings" data-page-search />
      </>,
    );
    press({ key: '/', code: 'Slash' }, document.body);
    expect(document.activeElement).toBe(screen.getByLabelText('Search meetings'));
    expect(openSearch).not.toHaveBeenCalled();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ShortcutProvider>
          <Search />
        </ShortcutProvider>
      </QueryClientProvider>,
    );
    press({ key: '/', code: 'Slash' }, document.body);
    expect(openSearch).toHaveBeenCalledTimes(1);
  });

  it('refreshes the data on screen with R and says so', async () => {
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'refetchQueries').mockResolvedValue(undefined);
    wrap(<p>Board</p>, qc);
    press({ key: 'r', code: 'KeyR' }, document.body);
    expect(refetch).toHaveBeenCalledWith({ type: 'active' });
    expect(await screen.findByText(/refreshed/i)).toBeTruthy();
  });

  it('does not refresh under a form dialog, but does in a panel that allows it', () => {
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, 'refetchQueries').mockResolvedValue(undefined);
    const { rerender } = wrap(
      <div role="dialog" aria-modal="true" aria-label="Edit task">
        <form>
          <button type="submit">Save</button>
        </form>
      </div>,
      qc,
    );
    press({ key: 'r', code: 'KeyR' }, document.body);
    expect(refetch).not.toHaveBeenCalled();
    rerender(
      <QueryClientProvider client={qc}>
        <ShortcutProvider>
          <div role="dialog" aria-modal="true" aria-label="Task" data-shortcut-refresh>
            <form>
              <textarea aria-label="Comment" />
            </form>
          </div>
        </ShortcutProvider>
      </QueryClientProvider>,
    );
    press({ key: 'r', code: 'KeyR' }, document.body);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('opens the list with Ctrl+/ or ?, and closes it with Escape', () => {
    wrap(<p>Page</p>);
    press({ key: '/', code: 'Slash', ctrlKey: true }, document.body);
    const list = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(list.textContent).toContain('Save');
    expect(list.textContent).toContain('Ctrl');
    press({ key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    press({ key: '?', code: 'Slash', shiftKey: true }, document.body);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('switches single-key shortcuts off from the list, and remembers it', () => {
    const onNew = vi.fn();
    wrap(<Page on={onNew} />);
    press({ key: '/', code: 'Slash', ctrlKey: true }, document.body);
    fireEvent.click(screen.getByRole('switch', { name: /single-key shortcuts/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    press(N, document.body);
    expect(onNew).not.toHaveBeenCalled();
    expect(localStorage.getItem('mico360.shortcuts.singleKeys')).toBe('off');
  });
});

describe('hints', () => {
  it('puts the shortcut in a button’s tooltip and tells screen readers, unless single keys are off', async () => {
    const { Button } = await import('../ui/Button');
    wrap(
      <Button title="New project" shortcut="new">
        + New project
      </Button>,
    );
    const button = screen.getByRole('button', { name: /new project/i });
    expect(button.getAttribute('title')).toBe('New project (N)');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('N');
    press({ key: '/', code: 'Slash', ctrlKey: true }, document.body);
    fireEvent.click(screen.getByRole('switch', { name: /single-key shortcuts/i }));
    expect(button.getAttribute('title')).toBe('New project');
    expect(button.getAttribute('aria-keyshortcuts')).toBeNull();
  });

  it('names a Save button’s keys from its own text when it has no tooltip', async () => {
    const { Button } = await import('../ui/Button');
    wrap(
      <Button type="submit" shortcut="save">
        Save changes
      </Button>,
    );
    const button = screen.getByRole('button', { name: /save changes/i });
    expect(button.getAttribute('title')).toBe('Save changes (Ctrl+S)');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+S');
  });
});
