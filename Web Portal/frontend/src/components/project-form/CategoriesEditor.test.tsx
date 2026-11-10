import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoriesEditor } from './CategoriesEditor';
import { useAuthStore } from '../../stores/auth-store';
import { CATEGORY_TONES, CATEGORY_WORDS } from '../../lib/task-categories';
import type { ApiCategory } from '../../api/categories';
import { windowWidth } from '../../test/window-width';

/**
 * 1.24 A project's Categories settings (in the Edit project window): admins and the project's managers
 * add, rename, recolour, reorder (drag or keyboard), retire and delete its categories and set "Every
 * task needs a category"; everyone else sees the list. Every change is saved at once.
 */

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const cat = (over: Partial<ApiCategory> & Pick<ApiCategory, 'id' | 'name' | 'color' | 'position'>): ApiCategory => ({ projectId: 'p1', retired: false, retiredAt: null, taskCount: 0, ...over });

let world: { requireCategory: boolean; canManage: boolean; categories: ApiCategory[] };
let sent: { method: string; path: string; body: unknown }[];
let refuse: ((method: string, path: string) => Response | null) | null;
const requests = (method: string, path: string) => sent.filter((r) => r.method === method && r.path === path);
const key = (name: string) => name.toLowerCase().replace(/\s+/g, '');

beforeEach(() => {
  sent = [];
  refuse = null;
  world = {
    requireCategory: false,
    canManage: true,
    categories: [
      cat({ id: 'a', name: 'Electrical', color: 'teal', position: 0, taskCount: 3 }),
      cat({ id: 'b', name: 'Civil', color: 'cyan', position: 1, taskCount: 0 }),
      cat({ id: 'c', name: 'Old works', color: 'gold', position: 2, retired: true, retiredAt: '2026-11-01T06:00:00.000Z', taskCount: 2 }),
    ],
  };
  useAuthStore.getState().setSession({ user: { id: 'admin', email: 'a@x', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x');
      const path = u.pathname.replace(/^\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      sent.push({ method, path, body });
      const refused = refuse?.(method, path);
      if (refused) return refused;
      const sorted = () => [...world.categories].sort((x, y) => x.position - y.position);
      if (path === '/projects/p1/categories' && method === 'GET') {
        const categories = sorted().map((c) => (world.canManage ? c : (({ taskCount: _t, ...rest }) => rest)(c)));
        return json({ data: { requireCategory: world.requireCategory, canManage: world.canManage, categories } });
      }
      if (path === '/projects/p1/categories' && method === 'POST') {
        const { name, color } = body as { name: string; color: string };
        if (world.categories.some((c) => key(c.name) === key(name))) return json({ error: { code: 'CATEGORY_DUPLICATE', message: CATEGORY_WORDS.duplicate } }, 409);
        const made = cat({ id: `n${world.categories.length}`, name, color, position: world.categories.length });
        world.categories.push(made);
        return json({ data: made }, 201);
      }
      if (path === '/projects/p1/categories/order' && method === 'PUT') {
        const { orderedIds } = body as { orderedIds: string[] };
        orderedIds.forEach((id, i) => (world.categories.find((c) => c.id === id)!.position = i));
        return json({ data: sorted() });
      }
      if (path === '/projects/p1/category-settings' && method === 'PUT') {
        world.requireCategory = (body as { requireCategory: boolean }).requireCategory;
        return json({ data: { requireCategory: world.requireCategory } });
      }
      const one = /^\/project-categories\/(\w+)$/.exec(path);
      if (one) {
        const c = world.categories.find((x) => x.id === one[1])!;
        if (method === 'DELETE') {
          if ((c.taskCount ?? 0) > 0) return json({ error: { code: 'CATEGORY_IN_USE', message: CATEGORY_WORDS.inUse } }, 409);
          world.categories = world.categories.filter((x) => x.id !== c.id);
          return json(null, 204);
        }
        const patch = body as { name?: string; color?: string; retired?: boolean };
        if (patch.name && world.categories.some((x) => x.id !== c.id && key(x.name) === key(patch.name!))) return json({ error: { code: 'CATEGORY_DUPLICATE', message: CATEGORY_WORDS.duplicate } }, 409);
        if (patch.name) c.name = patch.name;
        if (patch.color) c.color = patch.color;
        if (patch.retired !== undefined) {
          c.retired = patch.retired;
          c.retiredAt = patch.retired ? '2026-11-10T06:00:00.000Z' : null;
        }
        return json({ data: c });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

let qc: QueryClient;
function renderEditor() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CategoriesEditor projectId="p1" />
    </QueryClientProvider>,
  );
}

const list = () => screen.getByRole('list', { name: 'Categories, in order' });
/** The categories as listed: each row's name (and its "retired" mark). */
async function names() {
  const l = await screen.findByRole('list', { name: 'Categories, in order' });
  return within(l)
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-category-name') + (li.hasAttribute('data-retired') ? ' (retired)' : ''));
}
const rowOf = (name: string) => within(list()).getAllByRole('listitem').find((li) => li.getAttribute('data-category-name') === name)!;

describe('CategoriesEditor (a manager)', () => {
  it('lists the project’s categories in order, with their colour and a "retired" mark, and says changes save at once', async () => {
    renderEditor();
    expect(screen.getByRole('heading', { name: /^Categories/ })).toBeInTheDocument();
    expect(screen.getByText(CATEGORY_WORDS.settingsHint)).toBeInTheDocument();
    expect(await names()).toEqual(['Electrical', 'Civil', 'Old works (retired)']);
    expect(screen.getByText('Changes to categories save straight away.')).toBeInTheDocument();
    const swatch = rowOf('Electrical').querySelector('.cat-swatch') as HTMLElement;
    expect(swatch.style.getPropertyValue('--cat-light-fill')).toBe(CATEGORY_TONES.teal.light.fill);
    expect(within(rowOf('Old works')).getByText(CATEGORY_WORDS.retired)).toBeInTheDocument();
    expect(within(rowOf('Electrical')).getByText('On 3 tasks')).toBeInTheDocument();
  });

  it('adds one: a name of up to 40 characters and one of the 12 colours (the first unused one to start with)', async () => {
    renderEditor();
    await names();
    const add = screen.getByRole('group', { name: CATEGORY_WORDS.add });
    const colours = within(add).getByRole('radiogroup', { name: CATEGORY_WORDS.colour });
    expect(within(colours).getAllByRole('radio')).toHaveLength(12);
    // Teal, cyan and gold are taken: indigo is next.
    expect(within(colours).getByRole('radio', { name: 'Indigo' })).toBeChecked();
    const name = within(add).getByRole('textbox', { name: 'Category name' });
    expect(name).toHaveAttribute('maxLength', '40');

    // A blank name is refused here.
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }));
    expect(within(add).getByText('Enter a name for the category.')).toBeInTheDocument();
    expect(requests('POST', '/projects/p1/categories')).toHaveLength(0);

    await userEvent.type(name, '  Mechanical   works ');
    await userEvent.click(within(colours).getByRole('radio', { name: 'Pink' }));
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(requests('POST', '/projects/p1/categories')).toHaveLength(1));
    expect(requests('POST', '/projects/p1/categories')[0]!.body).toEqual({ name: 'Mechanical works', color: 'pink' });
    await waitFor(async () => expect(await names()).toEqual(['Electrical', 'Civil', 'Old works (retired)', 'Mechanical works']));
    expect(name).toHaveValue('');
    // The next colour not used yet.
    expect(within(colours).getByRole('radio', { name: 'Indigo' })).toBeChecked();

    // Enter adds too.
    await userEvent.type(name, 'Safety{Enter}');
    await waitFor(() => expect(requests('POST', '/projects/p1/categories')).toHaveLength(2));
    expect(requests('POST', '/projects/p1/categories')[1]!.body).toEqual({ name: 'Safety', color: 'indigo' });
  });

  it('a name the project already has is refused with the server’s words', async () => {
    renderEditor();
    await names();
    const add = screen.getByRole('group', { name: CATEGORY_WORDS.add });
    await userEvent.type(within(add).getByRole('textbox', { name: 'Category name' }), 'civil{Enter}');
    expect(await within(add).findByText(CATEGORY_WORDS.duplicate)).toBeInTheDocument();
  });

  it('renames one in its row (Enter saves, Escape leaves it as it was)', async () => {
    renderEditor();
    await names();
    await userEvent.click(within(rowOf('Civil')).getByRole('button', { name: 'Rename Civil' }));
    const box = within(rowOf('Civil')).getByRole('textbox', { name: 'New name for Civil' });
    expect(box).toHaveValue('Civil');
    expect(box).toHaveFocus();
    await userEvent.clear(box);
    await userEvent.type(box, 'Electrical{Enter}');
    expect(await within(rowOf('Civil')).findByText(CATEGORY_WORDS.duplicate)).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'Civil works{Enter}');
    await waitFor(() => expect(requests('PUT', '/project-categories/b').at(-1)!.body).toEqual({ name: 'Civil works' }));
    await waitFor(async () => expect(await names()).toEqual(['Electrical', 'Civil works', 'Old works (retired)']));

    await userEvent.click(within(rowOf('Electrical')).getByRole('button', { name: 'Rename Electrical' }));
    await userEvent.type(within(rowOf('Electrical')).getByRole('textbox', { name: 'New name for Electrical' }), 'zzz{Escape}');
    expect(within(rowOf('Electrical')).queryByRole('textbox')).toBeNull();
    expect(requests('PUT', '/project-categories/a')).toHaveLength(0);
  });

  it('changes a colour from the 12 (each named)', async () => {
    renderEditor();
    await names();
    await userEvent.click(within(rowOf('Electrical')).getByRole('button', { name: 'Change colour of Electrical' }));
    const colours = screen.getByRole('radiogroup', { name: 'Colour for Electrical' });
    expect(within(colours).getByRole('radio', { name: 'Teal' })).toBeChecked();
    await userEvent.click(within(colours).getByRole('radio', { name: 'Plum' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save colour' }));
    await waitFor(() => expect(requests('PUT', '/project-categories/a')[0]!.body).toEqual({ color: 'plum' }));
    await waitFor(() => expect((rowOf('Electrical').querySelector('.cat-swatch') as HTMLElement).style.getPropertyValue('--cat-light-fill')).toBe(CATEGORY_TONES.plum.light.fill));
    expect(screen.queryByRole('radiogroup', { name: 'Colour for Electrical' })).toBeNull();
  });

  it('reorders with Move up / Move down, and with Alt+↑ / Alt+↓ (saved as the new order)', async () => {
    renderEditor();
    await names();
    expect(within(rowOf('Electrical')).getByRole('button', { name: 'Move up Electrical' })).toBeDisabled();
    expect(within(rowOf('Old works')).getByRole('button', { name: 'Move down Old works' })).toBeDisabled();
    await userEvent.click(within(rowOf('Electrical')).getByRole('button', { name: 'Move down Electrical' }));
    expect(await names()).toEqual(['Civil', 'Electrical', 'Old works (retired)']);
    await waitFor(() => expect(requests('PUT', '/projects/p1/categories/order')).toHaveLength(1));
    expect(requests('PUT', '/projects/p1/categories/order')[0]!.body).toEqual({ orderedIds: ['b', 'a', 'c'] });
    // Said for a screen reader.
    expect(screen.getByText('Electrical moved to place 2 of 3.')).toBeInTheDocument();
    // The keyboard stays on the button that moved it.
    expect(within(rowOf('Electrical')).getByRole('button', { name: 'Move down Electrical' })).toHaveFocus();

    // Alt+↑ from anywhere in the row.
    within(rowOf('Old works')).getByRole('button', { name: 'Rename Old works' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(await names()).toEqual(['Civil', 'Old works (retired)', 'Electrical']);
    await waitFor(() => expect(requests('PUT', '/projects/p1/categories/order')).toHaveLength(2));
    expect(requests('PUT', '/projects/p1/categories/order')[1]!.body).toEqual({ orderedIds: ['b', 'c', 'a'] });
    expect(within(rowOf('Old works')).getByRole('button', { name: 'Rename Old works' })).toHaveFocus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(await names()).toEqual(['Civil', 'Electrical', 'Old works (retired)']);
    await waitFor(() => expect(requests('PUT', '/projects/p1/categories/order')).toHaveLength(3));
  });

  it('reorders by dragging a row onto another', async () => {
    renderEditor();
    await names();
    const from = rowOf('Old works');
    const to = rowOf('Electrical');
    expect(from).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(from);
    fireEvent.dragEnter(to);
    fireEvent.dragOver(to);
    fireEvent.drop(to);
    fireEvent.dragEnd(from);
    expect(await names()).toEqual(['Old works (retired)', 'Electrical', 'Civil']);
    await waitFor(() => expect(requests('PUT', '/projects/p1/categories/order')[0]!.body).toEqual({ orderedIds: ['c', 'a', 'b'] }));
  });

  it('retires one (kept on its tasks) and uses it again', async () => {
    renderEditor();
    await names();
    await userEvent.click(within(rowOf('Civil')).getByRole('button', { name: 'Retire Civil' }));
    await waitFor(() => expect(requests('PUT', '/project-categories/b')[0]!.body).toEqual({ retired: true }));
    await waitFor(async () => expect(await names()).toEqual(['Electrical', 'Civil (retired)', 'Old works (retired)']));
    await userEvent.click(within(rowOf('Old works')).getByRole('button', { name: 'Use Old works again' }));
    await waitFor(() => expect(requests('PUT', '/project-categories/c')[0]!.body).toEqual({ retired: false }));
    await waitFor(async () => expect(await names()).toEqual(['Electrical', 'Civil (retired)', 'Old works']));
  });

  it('deletes only a category no task uses; otherwise says why (retire it instead)', async () => {
    renderEditor();
    await names();
    const used = within(rowOf('Electrical')).getByRole('button', { name: 'Delete Electrical' });
    expect(used).toHaveAttribute('aria-disabled', 'true');
    expect(used).toHaveAttribute('title', CATEGORY_WORDS.inUse);
    await userEvent.click(used);
    expect(screen.getByRole('alert')).toHaveTextContent(CATEGORY_WORDS.inUse);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await userEvent.click(within(rowOf('Civil')).getByRole('button', { name: 'Delete Civil' }));
    const ask = screen.getByRole('alertdialog', { name: 'Delete Civil?' });
    expect(requests('DELETE', '/project-categories/b')).toHaveLength(0);
    await userEvent.click(within(ask).getByRole('button', { name: 'Delete category' }));
    await waitFor(() => expect(requests('DELETE', '/project-categories/b')).toHaveLength(1));
    await waitFor(async () => expect(await names()).toEqual(['Electrical', 'Old works (retired)']));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Every task needs a category" is a switch, saved at once', async () => {
    renderEditor();
    await names();
    const sw = screen.getByRole('switch', { name: CATEGORY_WORDS.require });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription(CATEGORY_WORDS.requireHint);
    await userEvent.click(sw);
    await waitFor(() => expect(requests('PUT', '/projects/p1/category-settings')[0]!.body).toEqual({ requireCategory: true }));
    await waitFor(() => expect(screen.getByRole('switch', { name: CATEGORY_WORDS.require })).toHaveAttribute('aria-checked', 'true'));
  });

  it('reads the list again under [categories, projectId] after a change (the task forms read it there)', async () => {
    renderEditor();
    await names();
    // tgc: one key for every view (lib/useProjectCategories reads the same one).
    const before = requests('GET', '/projects/p1/categories').length;
    await userEvent.click(within(rowOf('Civil')).getByRole('button', { name: 'Retire Civil' }));
    await waitFor(() => expect(requests('GET', '/projects/p1/categories').length).toBeGreaterThan(before));
    await waitFor(() => expect(qc.getQueryData(['categories', 'p1'])).toMatchObject({ canManage: true }));
  });

  it('a refused change shows the server’s words', async () => {
    refuse = (method) => (method === 'PUT' ? json({ error: { code: 'FORBIDDEN', message: CATEGORY_WORDS.notManager } }, 403) : null);
    renderEditor();
    await names();
    await userEvent.click(within(rowOf('Civil')).getByRole('button', { name: 'Retire Civil' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CATEGORY_WORDS.notManager);
  });

  it('on a phone it starts folded and opens with its heading', async () => {
    windowWidth(375);
    renderEditor();
    const toggle = screen.getByRole('button', { name: /^Categories/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Categories, in order' })).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await names()).toHaveLength(3);
  });
});

describe('CategoriesEditor (not a manager)', () => {
  it('shows the list and the rule, changes nothing', async () => {
    world.canManage = false;
    world.requireCategory = true;
    renderEditor();
    expect(await names()).toEqual(['Electrical', 'Civil', 'Old works (retired)']);
    expect(screen.getByText(CATEGORY_WORDS.notManager)).toBeInTheDocument();
    expect(screen.queryByText('Changes to categories save straight away.')).toBeNull();
    const sw = screen.getByRole('switch', { name: CATEGORY_WORDS.require });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toBeDisabled();
    expect(within(list()).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: CATEGORY_WORDS.add })).toBeNull();
    expect(rowOf('Electrical')).not.toHaveAttribute('draggable', 'true');
    await act(async () => {});
    expect(sent.filter((r) => r.method !== 'GET')).toHaveLength(0);
  });

  it('an empty list says so', async () => {
    world.canManage = false;
    world.categories = [];
    renderEditor();
    expect(await screen.findByText(CATEGORY_WORDS.none)).toBeInTheDocument();
  });
});
