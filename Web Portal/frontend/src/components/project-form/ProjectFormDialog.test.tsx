import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectFormDialog } from './ProjectFormDialog';
import { useAuthStore } from '../../stores/auth-store';
import type { ApiProject } from '../../api/projects';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const existing: ApiProject = {
  id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: 'The platform', clientName: 'Petroleum Development Oman', status: 'ACTIVE', priority: 'HIGH',
  color: '#8B1E1E', icon: null, imageUrl: '/uploads/old.webp', ownerId: 'u1', startDate: null, targetDate: null, createdAt: '', updatedAt: '',
};

let requests: { url: string; method: string; body?: unknown }[];
let override: (u: string, method: string) => Response | Promise<Response> | undefined;

beforeEach(() => {
  requests = [];
  override = () => undefined;
  useAuthStore.getState().setSession({ user: { id: 'admin', email: 'a@x', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('XMLHttpRequest', undefined); // uploads go through fetch here
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 400 });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn(), clearRect: vi.fn(), imageSmoothingQuality: 'high', imageSmoothingEnabled: true })) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) { cb(new Blob(['img'], { type: type ?? 'image/png' })); } as never;
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    requests.push({ url: u, method, body });
    const o = override(u, method);
    if (o) return o;
    if (u.includes('/projects/code-check')) {
      const code = new URL(u, 'http://t').searchParams.get('code')!.toUpperCase();
      return json({ data: code === 'MICO' ? { code, valid: true, available: false, suggestion: 'MICO2' } : { code, valid: /^[A-Z][A-Z0-9]{1,9}$/.test(code), available: /^[A-Z][A-Z0-9]{1,9}$/.test(code) } });
    }
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [existing] });
    if (u.endsWith('/projects') && method === 'POST') return json({ data: { ...existing, ...(body as object), id: 'pNew', imageUrl: null } }, 201);
    if (/\/projects\/\w+$/.test(u) && method === 'PUT') return json({ data: { ...existing, ...(body as object) } });
    if (u.endsWith('/image') && method === 'POST') return json({ data: { ...existing, id: u.includes('pNew') ? 'pNew' : 'p1', imageUrl: '/uploads/new.webp' } });
    if (u.endsWith('/image') && method === 'DELETE') return json({ data: { ...existing, imageUrl: null } });
    if (u.endsWith('/users/directory')) {
      return json({
        data: [
          { id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
          { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Ahmed' },
          { id: 'emp', username: 'sara', firstName: 'Sara', lastName: 'Said', active: true },
          { id: 'admin', username: 'admin', firstName: 'Khurram', lastName: 'Admin', active: true },
          // Deactivated: still named in history, never offered.
          { id: 'u3', username: 'layla', firstName: 'Layla', lastName: 'Gone', active: false },
        ],
      });
    }
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderForm(props: Partial<React.ComponentProps<typeof ProjectFormDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ProjectFormDialog onClose={onClose} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

const posts = (path: RegExp) => requests.filter((r) => r.method === 'POST' && path.test(r.url));

async function chooseImage(file: File) {
  fireEvent.change(screen.getByLabelText('Project image file'), { target: { files: [file] } });
  const img = await screen.findByAltText('Picture to crop');
  fireEvent.load(img);
}

describe('New project form', () => {
  it('marks what is required, suggests an editable code from the name, and creates the project with its look', async () => {
    const { onSaved, onClose } = renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    expect(within(dialog).getByLabelText(/^name/i)).toHaveAttribute('aria-required', 'true');
    expect(within(dialog).getByLabelText(/^code/i)).toHaveAttribute('aria-required', 'true');
    expect(within(dialog).getByText(/client/i, { selector: 'label' })).toHaveTextContent(/optional/i);

    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Rig Inspection Portal');
    expect(within(dialog).getByLabelText(/^code/i)).toHaveValue('RIP');
    expect(await within(dialog).findByText(/RIP is free/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /change icon or image/i }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Rocket' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Blue' }));
    await userEvent.type(within(dialog).getByLabelText(/^client/i), 'Petroleum Development Oman');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    await userEvent.click(await screen.findByRole('option', { name: /Omar Ahmed/ }));
    expect(within(dialog).getByText(/new tasks .* assigned to the owner/i)).toHaveTextContent(/reassign/i);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posts(/\/projects$/)[0]!.body).toEqual({
      code: 'RIP', name: 'Rig Inspection Portal', clientName: 'Petroleum Development Oman', status: 'PLANNING', priority: 'NORMAL', ownerId: 'u2', icon: 'rocket', color: '#1E5A8B',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a code you typed when the name changes, and checks its format there and then', async () => {
    renderForm();
    const code = screen.getByLabelText(/^code/i);
    await userEvent.type(code, '1ab');
    expect(code).toHaveValue('1AB');
    expect(await screen.findByText(/codes start with a letter/i)).toBeInTheDocument();
    expect(code).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(code);
    await userEvent.type(code, 'ops');
    await userEvent.type(screen.getByLabelText(/^name/i), 'Operations Hub');
    expect(code).toHaveValue('OPS');
  });

  it('says when a code is taken and offers a free one', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/^code/i), 'mico');
    expect(await screen.findByText(/MICO is already used/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use MICO2' }));
    expect(screen.getByLabelText(/^code/i)).toHaveValue('MICO2');
  });

  it('does not send a form with a missing name or bad code', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(/give the project a name/i)).toBeInTheDocument();
    expect(posts(/\/projects$/)).toHaveLength(0);
    expect(screen.getByLabelText(/^name/i)).toHaveFocus();
  });

  it('drops the "needs a code" message once a name suggests one', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('A project needs a code.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Rig Inspection Portal');
    expect(screen.queryByText('A project needs a code.')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^code/i)).not.toHaveAttribute('aria-invalid');
    expect(await screen.findByText(/RIP is free/)).toBeInTheDocument();
  });

  it('keeps everything typed when the server refuses the code, and shows it at the code', async () => {
    override = (u, m) => (u.endsWith('/projects') && m === 'POST' ? json({ error: { code: 'DUPLICATE_PROJECT_CODE', message: 'The code RIP is already used by another project.' } }, 409) : undefined);
    renderForm();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Rig Inspection Portal');
    await userEvent.type(screen.getByLabelText(/^description/i), 'Inspections of the rigs');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(/already used by another project/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^code/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^description/i)).toHaveValue('Inspections of the rigs');
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
  });

  it('says so when saving fails, keeps the form, and lets it be sent again — once at a time', async () => {
    let release: (r: Response) => void = () => {};
    let attempts = 0;
    override = (u, m) => {
      if (!(u.endsWith('/projects') && m === 'POST')) return undefined;
      attempts += 1;
      if (attempts === 1) return json({ error: { code: 'ERR', message: 'boom' } }, 500);
      return new Promise<Response>((r) => { release = r; });
    };
    renderForm();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Rig Inspection Portal');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t create the project/i);
    const create = screen.getByRole('button', { name: /create project/i });
    await userEvent.click(create);
    expect(await screen.findByRole('button', { name: /creating/i })).toHaveAttribute('aria-busy', 'true');
    // A second press (or Enter) while it is saving sends nothing more.
    await userEvent.click(screen.getByRole('button', { name: /creating/i }));
    fireEvent.submit(screen.getByLabelText(/^name/i).closest('form')!);
    expect(posts(/\/projects$/)).toHaveLength(2);
    await act(async () => { release(json({ data: { ...existing, id: 'pNew', code: 'RIP', name: 'Rig Inspection Portal' } }, 201)); });
  });

  it('asks before throwing away what was typed', async () => {
    const { onClose } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1); // nothing typed: closes at once
    onClose.mockClear();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Half done');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const ask = await screen.findByRole('alertdialog', { name: /discard your changes/i });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^name/i)).toHaveValue('Half done');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Project image', () => {
  it('crops a chosen picture, previews it, and uploads it with the new project', async () => {
    const { onSaved } = renderForm();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Rig Inspection Portal');
    await userEvent.click(screen.getByRole('button', { name: /change icon or image/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    await chooseImage(new File(['png'], 'logo.png', { type: 'image/png' }));
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('group', { name: /drag to position/i }), { key: 'ArrowLeft' });
    await userEvent.click(screen.getByRole('button', { name: 'Use this picture' }));
    expect(screen.getByRole('img', { name: /project picture preview/i }).querySelector('img')).toHaveAttribute('src', 'blob:preview');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const upload = posts(/\/projects\/pNew\/image$/)[0]!;
    const file = (upload.body as FormData).get('file') as File;
    expect(file.type).toMatch(/image\/(webp|png)/);
  });

  it('refuses other file types and large files before uploading', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: /change icon or image/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    fireEvent.change(screen.getByLabelText('Project image file'), { target: { files: [new File(['gif'], 'anim.gif', { type: 'image/gif' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/use a PNG, JPG or WebP image/i);
    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Project image file'), { target: { files: [big] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/is 11.0 MB .* up to 10 MB/i);
    expect(screen.queryByAltText('Picture to crop')).not.toBeInTheDocument();
  });

  it('keeps the new project and offers to try the picture again when its upload fails', async () => {
    let fail = true;
    override = (u, m) => (u.endsWith('/image') && m === 'POST' && fail ? json({ error: { code: 'VALIDATION', message: 'Images can be up to 4096 × 4096 pixels.' } }, 400) : undefined);
    const { onSaved } = renderForm();
    await userEvent.type(screen.getByLabelText(/^name/i), 'Rig Inspection Portal');
    await userEvent.click(screen.getByRole('button', { name: /change icon or image/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    await chooseImage(new File(['png'], 'logo.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this picture' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/project was created, but its picture wasn’t saved.*4096/i);
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posts(/\/projects$/)).toHaveLength(1); // the project itself was not created twice
  });
});

describe('Edit project form', () => {
  it('takes an optional project number beside the code', async () => {
    const { onSaved } = renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    const number = within(dialog).getByLabelText(/^project number/i);
    expect(within(dialog).getByText(/project number/i, { selector: 'label' })).toHaveTextContent(/optional/i);
    expect(number).toHaveAttribute('maxLength', '40');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Rig Inspection Portal');
    await userEvent.type(number, ' PDO-2026-014 ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posts(/\/projects$/)[0]!.body).toMatchObject({ code: 'RIP', name: 'Rig Inspection Portal', number: 'PDO-2026-014' });
  });

  it('changes or clears a project’s number', async () => {
    const { onSaved } = renderForm({ project: { ...existing, number: '1024' } });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByLabelText(/^project number/i)).toHaveValue('1024');
    await userEvent.clear(within(dialog).getByLabelText(/^project number/i));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.find((r) => r.method === 'PUT')!.body).toEqual({ number: null });
  });

  it('starts from the project, keeps its code, and saves only what changed', async () => {
    const { onSaved } = renderForm({ project: existing });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('MICO360 Platform');
    expect(within(dialog).getByLabelText(/^code/i)).toHaveAttribute('readonly');
    expect(within(dialog).getByText(/task keys use this code/i)).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText(/^name/i));
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'MICO360 Platform 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toMatch(/\/projects\/p1$/);
    expect(put.body).toEqual({ name: 'MICO360 Platform 2' });
    expect(requests.some((r) => r.url.endsWith('/image'))).toBe(false);
  });

  it('says the details were saved when only the new picture fails, and retries just the picture', async () => {
    let fail = true;
    override = (u, m) => (u.endsWith('/image') && m === 'POST' && fail ? json({ error: { code: 'VALIDATION', message: 'Images can be up to 2 MB.' } }, 400) : undefined);
    const { onSaved } = renderForm({ project: existing });
    await userEvent.clear(screen.getByLabelText(/^name/i));
    await userEvent.type(screen.getByLabelText(/^name/i), 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: /change icon or image/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    await userEvent.click(screen.getByRole('button', { name: /replace picture|choose a picture/i }));
    await chooseImage(new File(['png'], 'logo.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this picture' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The other changes were saved, but the picture wasn’t: Images can be up to 2 MB.');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1); // the name was not sent twice
  });

  it('replaces or removes the picture', async () => {
    const { onSaved } = renderForm({ project: existing });
    await userEvent.click(screen.getByRole('button', { name: /change icon or image/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove picture' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/projects/p1/image'))).toBe(true);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false); // nothing else changed
  });

  it('closes at once when nothing changed', async () => {
    const { onClose } = renderForm({ project: existing });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('Project task settings', () => {
  it('has a Tasks section with two switches and plain help, starting as every project does', () => {
    renderForm();
    const tasks = within(screen.getByRole('dialog', { name: 'New project' })).getByRole('group', { name: 'Tasks' });
    const carry = within(tasks).getByRole('switch', { name: 'Carry unfinished tasks forward' });
    const due = within(tasks).getByRole('switch', { name: 'New tasks are due today' });
    expect(carry).toHaveAttribute('aria-checked', 'true');
    expect(due).toHaveAttribute('aria-checked', 'false');
    expect(carry).toHaveAccessibleDescription('Each night, unfinished tasks on past days move to today’s board.');
    expect(due).toHaveAccessibleDescription('A task added without a due date gets today’s date. Dates people choose are kept.');
  });

  it('creates a project with the settings that were switched', async () => {
    const { onSaved } = renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Rig Inspection Portal');
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Carry unfinished tasks forward' }));
    await userEvent.click(within(dialog).getByRole('switch', { name: 'New tasks are due today' }));
    expect(within(dialog).getByRole('switch', { name: 'Carry unfinished tasks forward' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posts(/\/projects$/)[0]!.body).toMatchObject({ code: 'RIP', carryForward: false, defaultDueToday: true });
  });

  it('starts from the project’s own settings and saves only the switch that changed', async () => {
    const { onSaved } = renderForm({ project: { ...existing, carryForward: false, defaultDueToday: false } });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByRole('switch', { name: 'Carry unfinished tasks forward' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(within(dialog).getByRole('switch', { name: 'New tasks are due today' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.find((r) => r.method === 'PUT')!.body).toEqual({ defaultDueToday: true });
  });

  it('a project saved before the settings existed shows what it does (carry forward on, due today off)', async () => {
    const { onClose } = renderForm({ project: existing });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByRole('switch', { name: 'Carry unfinished tasks forward' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('switch', { name: 'New tasks are due today' })).toHaveAttribute('aria-checked', 'false');
    // Switched and switched back is no change: the form closes without asking.
    await userEvent.click(within(dialog).getByRole('switch', { name: 'New tasks are due today' }));
    await userEvent.click(within(dialog).getByRole('switch', { name: 'New tasks are due today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when carry-forward is off for the whole company', async () => {
    override = (u) => (u.endsWith('/system-settings') ? json({ data: [{ key: 'carryForward.enabled', value: false }] }) : undefined);
    renderForm({ project: existing });
    expect(await screen.findByText('Carry-forward is turned off for the whole company in System Settings.')).toBeInTheDocument();
    // The project's own choice can still be set, for when it is turned back on.
    expect(screen.getByRole('switch', { name: 'Carry unfinished tasks forward' })).toBeEnabled();
  });

  it('says nothing about the company setting while it is on', async () => {
    override = (u) => (u.endsWith('/system-settings') ? json({ data: [{ key: 'carryForward.enabled', value: true }] }) : undefined);
    renderForm({ project: existing });
    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/system-settings'))).toBe(true));
    expect(screen.queryByText(/turned off for the whole company/i)).not.toBeInTheDocument();
  });
});

describe('Owner and team for a new project', () => {
  const signInAs = (id: string, roles: string[]) =>
    useAuthStore.getState().setSession({ user: { id, email: `${id}@x`, username: id, roles }, accessToken: 'at', refreshToken: 'rt' });
  const fill = async (dialog: HTMLElement) => {
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Rig Inspection Portal');
    expect(await within(dialog).findByText(/RIP is free/i)).toBeInTheDocument();
  };

  it('an employee owns it by default, may hand it to someone else, and picks a team', async () => {
    signInAs('emp', ['EMPLOYEE']);
    const { onSaved } = renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await fill(dialog);
    // The owner starts as the person creating it.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Owner' })).toHaveTextContent('Sara Said'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    const owners = await screen.findByRole('listbox');
    // Everyone active — not the deactivated, and no "No owner" for an employee's own project.
    expect(within(owners).queryByRole('option', { name: /Layla/ })).not.toBeInTheDocument();
    expect(within(owners).queryByRole('option', { name: 'No owner' })).not.toBeInTheDocument();
    await userEvent.click(within(owners).getByRole('option', { name: /Omar Ahmed/ }));

    // The team: active people as removable chips, picked from a search box.
    expect(within(dialog).getByText(/you’ll be on the team as a manager/i)).toBeInTheDocument();
    const add = within(dialog).getByRole('combobox', { name: 'Add people to the team' });
    await userEvent.click(add);
    expect(screen.queryByRole('option', { name: /Layla/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Ada Lovelace/ }));
    const team = within(dialog).getByRole('list', { name: 'Team' });
    expect(within(team).getByText('Ada Lovelace')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Add people to the team' }));
    await userEvent.click(screen.getByRole('option', { name: /Khurram Admin/ }));
    await userEvent.click(within(team).getByRole('button', { name: 'Remove Khurram Admin' }));
    expect(within(team).queryByText('Khurram Admin')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posts(/\/projects$/)[0]!.body).toMatchObject({ code: 'RIP', ownerId: 'u2', memberIds: ['u1'] });
  });

  it('an employee who keeps the project sends themselves as owner and no team when none is picked', async () => {
    signInAs('emp', ['EMPLOYEE']);
    const { onSaved } = renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await fill(dialog);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Owner' })).toHaveTextContent('Sara Said'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = posts(/\/projects$/)[0]!.body as Record<string, unknown>;
    expect(body.ownerId).toBe('emp');
    expect(body).not.toHaveProperty('memberIds');
  });

  it('an administrator owns it by default too, and may still leave it without an owner', async () => {
    renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Owner' })).toHaveTextContent('Khurram Admin'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    expect(await screen.findByRole('option', { name: 'No owner' })).toBeInTheDocument();
    expect(within(dialog).getByText(/the owner joins the team too/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/you’ll be on the team as a manager/i)).not.toBeInTheDocument();
  });

  it('has no team picker when editing (the Team tab runs an existing team)', () => {
    renderForm({ project: existing });
    expect(screen.queryByRole('combobox', { name: 'Add people to the team' })).not.toBeInTheDocument();
  });

  it('never offers a deactivated person as a new owner', async () => {
    renderForm({ project: existing });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Owner' })).toHaveTextContent('Ada Lovelace'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    const owners = await screen.findByRole('listbox');
    expect(within(owners).getByRole('option', { name: /Omar Ahmed/ })).toBeInTheDocument();
    expect(within(owners).queryByRole('option', { name: /Layla/ })).not.toBeInTheDocument();
  });

  it('when editing, keeps a deactivated owner shown (once), and offers only active people as a new one', async () => {
    renderForm({ project: { ...existing, ownerId: 'u3' } });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Owner' })).toHaveTextContent('Layla Gone'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    const owners = await screen.findByRole('listbox');
    expect(within(owners).getAllByRole('option', { name: /Layla/ })).toHaveLength(1);
    expect(within(owners).getByRole('option', { name: /Omar Ahmed/ })).toBeInTheDocument();
  });

  it('tells an employee owner handing the project over that they stay on as a manager', async () => {
    signInAs('emp', ['EMPLOYEE']);
    renderForm({ project: { ...existing, ownerId: 'emp' } });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).queryByText(/you’ll stay on the team as a manager/i)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    await userEvent.click(await screen.findByRole('option', { name: /Omar Ahmed/ }));
    expect(within(dialog).getByText(/you’ll stay on the team as a manager/i)).toBeInTheDocument();
  });
});
