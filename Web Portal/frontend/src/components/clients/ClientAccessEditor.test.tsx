import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientAccessEditor, type ClientAccessEditorProps } from './ClientAccessEditor';
import { grantsOf, rowsFromAccount, type AccessRow } from './client-access';
import { FIN, MICO, RIG, access, clientServer } from './test-server';
import { windowWidth } from '../../test/window-width';
import type { ClientPreviewDialogProps } from '../portal/ClientPreviewDialog';

// The portal lane builds the real preview: here, only what it is asked to show, and a form of its own.
const preview = vi.hoisted(() => ({ spec: null as unknown }));
vi.mock('../portal/ClientPreviewDialog', () => ({
  ClientPreviewDialog: ({ spec, onClose }: ClientPreviewDialogProps) => {
    preview.spec = spec;
    return (
      <div role="dialog" aria-label="Preview as client">
        <form onSubmit={(e) => e.preventDefault()}>
          <button type="submit">Send a comment</button>
        </form>
        <button type="button" onClick={onClose}>
          Close preview
        </button>
      </div>
    );
  },
}));

let latest: AccessRow[] = [];
interface HarnessProps {
  start?: AccessRow[];
  showErrors?: boolean;
  preview?: ClientAccessEditorProps['preview'];
  /** Inside a form (as in New client and Manage account): called when it is submitted. */
  onSubmit?: () => void;
}
function Harness({ start = [], showErrors = false, preview: who, onSubmit }: HarnessProps) {
  const [rows, setRows] = useState<AccessRow[]>(start);
  latest = rows;
  const editor = <ClientAccessEditor value={rows} onChange={setRows} idPrefix="t" showErrors={showErrors} {...(who ? { preview: who } : {})} />;
  return onSubmit ? (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {editor}
    </form>
  ) : (
    editor
  );
}
function renderEditor(props: HarnessProps = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}
async function addProject(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: 'Add a project' }));
  await userEvent.click(await screen.findByRole('option', { name }));
}
/** A tick, by its permission and project ("Comment — MICO Tower"). */
const box = (name: string) => screen.getByRole('checkbox', { name });
const roleOf = (project: string) => screen.getByRole('combobox', { name: `Role — ${project}` });
const VIEWER = ['View tasks', 'View meetings & minutes', 'Download reports', 'Receive notifications'];
const CONTRIBUTOR_ADDS = ['Comment', 'Upload documents', 'Reply to invites'];
const EIGHT = [...VIEWER, ...CONTRIBUTOR_ADDS, 'Sign off'];
const NO_ACTIONS = { comment: false, signOff: false, respond: false, download: false, upload: false, notify: false };

afterEach(() => {
  vi.unstubAllGlobals();
  latest = [];
  preview.spec = null;
});

describe('ClientAccessEditor: the permission matrix (1.23.7)', () => {
  it('before any project, the desktop table already shows the role, the eight permissions and what each role includes', async () => {
    windowWidth(1280);
    clientServer();
    renderEditor();
    const table = await screen.findByRole('table', { name: 'Permissions for each project' });
    const [ladder, columns] = within(table).getAllByRole('row');
    expect(within(ladder!).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Project', 'Role', 'Viewer', 'Contributor adds', 'Approver adds', 'Remove']);
    expect(within(columns!).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(EIGHT);
    expect(within(table).getByText('Add a project to give access')).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'What each role includes' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Viewer — View tasks, View meetings & minutes, Download reports, Receive notifications',
      'Contributor — Viewer, plus Comment, Upload documents, Reply to invites',
      'Approver — Contributor, plus Sign off',
      'Custom — Only the boxes you tick',
    ]);
  });

  it('on a phone: no table; the roles and “Add a project to give access” show before any project', async () => {
    windowWidth(375);
    clientServer();
    renderEditor();
    expect(await screen.findByText('Add a project to give access')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('list', { name: 'What each role includes' })).toHaveTextContent('Approver — Contributor, plus Sign off');
  });

  it('offers the projects from /clients/project-options; one added starts as Viewer — its four ticks on, nothing that writes', async () => {
    const server = clientServer();
    renderEditor();
    await addProject(/MICO Tower/);
    expect(server.requests('GET', '/clients/project-options')).toHaveLength(1);
    expect(roleOf('MICO Tower')).toHaveValue('VIEWER');
    expect(within(roleOf('MICO Tower')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Viewer', 'Contributor', 'Approver', 'Custom']);
    for (const p of VIEWER) expect(box(`${p} — MICO Tower`)).toBeChecked();
    for (const p of [...CONTRIBUTOR_ADDS, 'Sign off']) {
      expect(box(`${p} — MICO Tower`)).not.toBeChecked();
      expect(box(`${p} — MICO Tower`)).toBeEnabled();
    }
    expect(grantsOf(latest)).toEqual([{ projectId: 'p-mico', role: 'VIEWER', modules: { progress: true, meetings: true }, actions: { ...NO_ACTIONS, download: true, notify: true } }]);
  });

  it('picking a role ticks exactly its set; changing any tick makes the row Custom, and it stays Custom', async () => {
    clientServer();
    renderEditor();
    await addProject(/MICO Tower/);
    await userEvent.selectOptions(roleOf('MICO Tower'), 'CONTRIBUTOR');
    for (const p of [...VIEWER, ...CONTRIBUTOR_ADDS]) expect(box(`${p} — MICO Tower`)).toBeChecked();
    expect(box('Sign off — MICO Tower')).not.toBeChecked();
    await userEvent.selectOptions(roleOf('MICO Tower'), 'APPROVER');
    for (const p of EIGHT) expect(box(`${p} — MICO Tower`)).toBeChecked();

    await userEvent.click(box('Receive notifications — MICO Tower'));
    expect(roleOf('MICO Tower')).toHaveValue('CUSTOM');
    expect(latest[0]).toMatchObject({ role: 'CUSTOM', actions: { notify: false, signOff: true } });
    // Ticked again, the ticks match Approver — still Custom (pick Approver to make it Approver).
    await userEvent.click(box('Receive notifications — MICO Tower'));
    expect(roleOf('MICO Tower')).toHaveValue('CUSTOM');

    // Down the ladder: the extra ticks go. Custom keeps whatever is ticked.
    await userEvent.selectOptions(roleOf('MICO Tower'), 'VIEWER');
    expect(box('Comment — MICO Tower')).not.toBeChecked();
    await userEvent.selectOptions(roleOf('MICO Tower'), 'CUSTOM');
    for (const p of VIEWER) expect(box(`${p} — MICO Tower`)).toBeChecked();
    expect(grantsOf(latest)[0]).toMatchObject({ role: 'CUSTOM', modules: { progress: true, meetings: true }, actions: { ...NO_ACTIONS, download: true, notify: true } });
  });

  it('a tick whose view is off is greyed out, unticked and says what it needs; a view back on brings back nothing else', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(MICO, { role: 'APPROVER' })]) });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'View tasks — MICO Tower' }));
    for (const p of ['Comment', 'Upload documents', 'Sign off']) {
      expect(box(`${p} — MICO Tower`)).toBeDisabled();
      expect(box(`${p} — MICO Tower`)).not.toBeChecked();
      expect(box(`${p} — MICO Tower`)).toHaveAccessibleDescription('Needs View tasks');
    }
    expect(box('Reply to invites — MICO Tower')).toBeChecked();
    expect(box('Download reports — MICO Tower')).toBeChecked();

    await userEvent.click(box('View meetings & minutes — MICO Tower'));
    expect(box('Reply to invites — MICO Tower')).toBeDisabled();
    expect(box('Reply to invites — MICO Tower')).toHaveAccessibleDescription('Needs View meetings & minutes');
    for (const p of ['Download reports', 'Receive notifications']) {
      expect(box(`${p} — MICO Tower`)).toBeDisabled();
      expect(box(`${p} — MICO Tower`)).not.toBeChecked();
      expect(box(`${p} — MICO Tower`)).toHaveAccessibleDescription('Needs View tasks or View meetings & minutes');
    }
    expect(screen.getByText('Tick at least one of View tasks or View meetings & minutes.')).toBeInTheDocument();

    await userEvent.click(box('View tasks — MICO Tower'));
    expect(box('Comment — MICO Tower')).toBeEnabled();
    expect(box('Comment — MICO Tower')).not.toBeChecked();
    expect(screen.queryByText('Tick at least one of View tasks or View meetings & minutes.')).toBeNull();
    expect(grantsOf(latest)).toEqual([{ projectId: 'p-mico', role: 'CUSTOM', modules: { progress: true, meetings: false }, actions: NO_ACTIONS }]);
  });

  it('after a save attempt, a Custom project with neither view is marked on its view ticks', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(RIG)]), showErrors: true });
    const tasks = await screen.findByRole('checkbox', { name: 'View tasks — Rig Refit' });
    expect(tasks).toHaveAttribute('aria-invalid', 'true');
    expect(tasks).toHaveAccessibleDescription('Tick at least one of View tasks or View meetings & minutes.');
    expect(box('View meetings & minutes — Rig Refit')).toHaveAttribute('aria-invalid', 'true');
  });

  it('“Same for all projects” (two or more projects) gives every project that role', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(MICO, { modules: { meetings: true } })]) });
    await screen.findByRole('combobox', { name: 'Role — MICO Tower' });
    expect(screen.queryByRole('group', { name: 'Same for all projects' })).toBeNull();
    await addProject(/Rig Refit/);
    const all = screen.getByRole('group', { name: 'Same for all projects' });
    expect(within(all).getAllByRole('button').map((b) => b.textContent)).toEqual(['Viewer', 'Contributor', 'Approver']);
    await userEvent.click(within(all).getByRole('button', { name: 'Approver for every project' }));
    expect(latest.map((r) => r.role)).toEqual(['APPROVER', 'APPROVER']);
    expect(box('Sign off — MICO Tower')).toBeChecked();
    expect(box('Sign off — Rig Refit')).toBeChecked();
    await userEvent.click(within(all).getByRole('button', { name: 'Viewer for every project' }));
    expect(latest.map((r) => r.role)).toEqual(['VIEWER', 'VIEWER']);
    expect(box('Sign off — MICO Tower')).not.toBeChecked();
  });

  it('from 1024px: a table, one row per project — its name, code and company, the role, the eight ticks and Remove', async () => {
    windowWidth(1280);
    clientServer();
    renderEditor({ start: rowsFromAccount([access(MICO, { role: 'CONTRIBUTOR' }), access(FIN, { modules: { meetings: true } })]) });
    const table = await screen.findByRole('table', { name: 'Permissions for each project' });
    const [, , mico, fin] = within(table).getAllByRole('row');
    expect(mico).toHaveTextContent('MICO Tower');
    expect(mico).toHaveTextContent('MICO · Prolens Projects LLC');
    expect(within(mico!).getByRole('combobox', { name: 'Role — MICO Tower' })).toHaveValue('CONTRIBUTOR');
    expect(within(mico!).getByRole('checkbox', { name: 'Upload documents — MICO Tower' })).toBeChecked();
    expect(within(mico!).getAllByRole('checkbox')).toHaveLength(8);
    expect(within(fin!).getByRole('combobox', { name: 'Role — Finance Office' })).toHaveValue('CUSTOM');
    const comment = within(fin!).getByRole('checkbox', { name: 'Comment — Finance Office' });
    expect(comment).toBeDisabled();
    expect(comment).toHaveAccessibleDescription('Needs View tasks');
    await userEvent.click(within(fin!).getByRole('checkbox', { name: 'View tasks — Finance Office' }));
    expect(comment).toBeEnabled();
    await userEvent.click(within(fin!).getByRole('button', { name: 'Remove Finance Office' }));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(latest.map((r) => r.projectId)).toEqual(['p-mico']);
  });

  it('a project already on the list is not offered again, and Remove takes it off', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(MICO, { modules: { progress: true } })]) });
    await userEvent.click(await screen.findByRole('button', { name: 'Add a project' }));
    expect(screen.queryByRole('option', { name: /MICO Tower/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Rig Refit/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Finance Office/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Remove MICO Tower' }));
    expect(screen.queryByRole('group', { name: 'MICO Tower' })).toBeNull();
    expect(screen.getByText('Add a project to give access')).toBeInTheDocument();
    expect(latest).toEqual([]);
  });

  it('an archived project they have stays on the list, marked, so saving keeps it (as it was: Custom)', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access({ id: 'p-old', code: 'OLD', name: 'Old Works', company: null }, { modules: { progress: true }, archived: true })]) });
    const old = await screen.findByRole('group', { name: 'Old Works' });
    expect(within(old).getByText('Archived')).toBeInTheDocument();
    expect(within(old).getByText(/hidden in the Client portal/i)).toBeInTheDocument();
    expect(grantsOf(latest)).toEqual([{ projectId: 'p-old', role: 'CUSTOM', modules: { progress: true, meetings: false }, actions: NO_ACTIONS }]);
  });

  it('says so when there is no project to give', async () => {
    clientServer({ options: [] });
    renderEditor();
    await waitFor(() => expect(screen.getByText('There are no projects to give yet.')).toBeInTheDocument());
  });

  it('every tick, the role and the buttons are finger-sized on a touch screen — on a phone and in the table', async () => {
    const touch = /\[@media\(pointer:coarse\)\]:!?min-h-11/;
    const check = async () => {
      await screen.findByRole('combobox', { name: 'Role — Finance Office' });
      for (const b of screen.getAllByRole('checkbox')) expect(b.closest('label')!.className).toMatch(touch);
      expect(roleOf('Finance Office').className).toMatch(touch);
      // (Add a project is 44px everywhere.)
      for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/\[@media\(pointer:coarse\)\]:!?min-h-11|!min-h-\[44px\]/);
    };
    clientServer();
    const start = rowsFromAccount([access(FIN, { modules: { meetings: true } }), access(MICO, { role: 'VIEWER' })]);
    const first = renderEditor({ start, preview: { clientId: 'c-1' } });
    await check();
    first.unmount();
    windowWidth(1280);
    renderEditor({ start, preview: { clientId: 'c-1' } });
    await check();
  });
});

describe('ClientAccessEditor: Preview as client (1.23.7)', () => {
  it('is offered only where the form passes who the client is', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(MICO, { role: 'VIEWER' })]) });
    await screen.findByRole('combobox', { name: 'Role — MICO Tower' });
    expect(screen.queryByRole('button', { name: 'Preview as client' })).toBeNull();
  });

  it('waits for a project, and for a view on each; then opens the portal as they would see it, with the ticks on screen (unsaved)', async () => {
    clientServer();
    renderEditor({ preview: { firstName: 'Lina', lastName: 'Q', organisation: 'Owner Group', email: 'lina@owner.test' } });
    const button = await screen.findByRole('button', { name: 'Preview as client' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Add a project to preview what they would see.');
    await addProject(/MICO Tower/);
    expect(button).toBeEnabled();
    await userEvent.click(box('View tasks — MICO Tower'));
    await userEvent.click(box('View meetings & minutes — MICO Tower'));
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Tick a view on each project to preview.');
    await userEvent.click(box('View meetings & minutes — MICO Tower'));
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Preview as client' })).toBeInTheDocument();
    expect(preview.spec).toEqual({
      firstName: 'Lina',
      lastName: 'Q',
      organisation: 'Owner Group',
      email: 'lina@owner.test',
      projects: [{ projectId: 'p-mico', role: 'CUSTOM', modules: { progress: false, meetings: true }, actions: NO_ACTIONS }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('dialog', { name: 'Preview as client' })).toBeNull();
  });

  it('inside the account’s form: neither the button nor anything in the preview submits that form', async () => {
    clientServer();
    const onSubmit = vi.fn();
    renderEditor({ start: rowsFromAccount([access(MICO, { role: 'APPROVER' })]), preview: { clientId: 'c-huda' }, onSubmit });
    await userEvent.click(await screen.findByRole('button', { name: 'Preview as client' }));
    expect(preview.spec).toEqual({ clientId: 'c-huda', projects: grantsOf(latest) });
    await userEvent.click(screen.getByRole('button', { name: 'Send a comment' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
