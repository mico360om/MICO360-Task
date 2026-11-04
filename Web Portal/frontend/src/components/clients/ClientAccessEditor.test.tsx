import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ClientAccessEditor } from './ClientAccessEditor';
import { grantsOf, noModuleText, rowsFromAccount, rowsWithoutModule, type AccessRow } from './client-access';
import { FIN, MICO, RIG, access, clientServer } from './test-server';

let latest: AccessRow[] = [];
function Harness({ start = [], showErrors = false }: { start?: AccessRow[]; showErrors?: boolean }) {
  const [rows, setRows] = useState<AccessRow[]>(start);
  latest = rows;
  return <ClientAccessEditor value={rows} onChange={setRows} idPrefix="t" showErrors={showErrors} />;
}
function renderEditor(props: { start?: AccessRow[]; showErrors?: boolean } = {}) {
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
const card = (name: string) => screen.getByRole('group', { name });

afterEach(() => {
  vi.unstubAllGlobals();
  latest = [];
});

describe('ClientAccessEditor', () => {
  it('offers the projects from /clients/project-options; one added starts with every tick off and asks for a module', async () => {
    const server = clientServer();
    renderEditor();
    await addProject(/MICO Tower/);
    expect(server.requests('GET', '/clients/project-options')).toHaveLength(1);
    const mico = card('MICO Tower');
    for (const name of ['Progress, milestones and tasks', 'Meetings and minutes', 'Comment on tasks', 'Sign off finished tasks', 'Reply to meeting invites (and their own action items)', 'Download PDFs']) {
      expect(within(mico).getByRole('checkbox', { name })).not.toBeChecked();
    }
    expect(within(mico).getByText('Tick at least one module.')).toBeInTheDocument();
    expect(latest).toEqual([{ projectId: 'p-mico', code: 'MICO', name: 'MICO Tower', company: 'Prolens Projects LLC', archived: false, modules: { progress: false, meetings: false }, actions: { comment: false, signOff: false, respond: false, download: false } }]);
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
    expect(latest).toEqual([]);
  });

  it('an action whose module is off is greyed out with a short hint, and opens when its module is ticked', async () => {
    clientServer();
    renderEditor();
    await addProject(/MICO Tower/);
    const mico = card('MICO Tower');
    const comment = within(mico).getByRole('checkbox', { name: 'Comment on tasks' });
    const signOff = within(mico).getByRole('checkbox', { name: 'Sign off finished tasks' });
    const reply = within(mico).getByRole('checkbox', { name: 'Reply to meeting invites (and their own action items)' });
    const download = within(mico).getByRole('checkbox', { name: 'Download PDFs' });
    for (const box of [comment, signOff, reply, download]) expect(box).toBeDisabled();
    expect(comment).toHaveAccessibleDescription('Needs Progress');
    expect(signOff).toHaveAccessibleDescription('Needs Progress');
    expect(reply).toHaveAccessibleDescription('Needs Meetings');
    expect(download).toHaveAccessibleDescription('Needs a module');

    await userEvent.click(within(mico).getByRole('checkbox', { name: 'Progress, milestones and tasks' }));
    expect(comment).toBeEnabled();
    expect(signOff).toBeEnabled();
    expect(download).toBeEnabled();
    expect(reply).toBeDisabled();
    expect(within(mico).queryByText('Tick at least one module.')).toBeNull();
    await userEvent.click(comment);
    await userEvent.click(download);
    expect(latest[0]).toMatchObject({ modules: { progress: true, meetings: false }, actions: { comment: true, signOff: false, respond: false, download: true } });

    await userEvent.click(within(mico).getByRole('checkbox', { name: 'Meetings and minutes' }));
    expect(reply).toBeEnabled();
    await userEvent.click(reply);
    expect(latest[0]!.actions.respond).toBe(true);
  });

  it('turning a module off turns off its actions (never kept hidden), and Download stays while the other module is on', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(MICO, { modules: { progress: true, meetings: true }, actions: { comment: true, signOff: true, respond: true, download: true } })]) });
    const mico = await screen.findByRole('group', { name: 'MICO Tower' });
    await userEvent.click(within(mico).getByRole('checkbox', { name: 'Progress, milestones and tasks' }));
    expect(latest[0]).toMatchObject({ modules: { progress: false, meetings: true }, actions: { comment: false, signOff: false, respond: true, download: true } });
    expect(within(mico).getByRole('checkbox', { name: 'Comment on tasks' })).not.toBeChecked();
    await userEvent.click(within(mico).getByRole('checkbox', { name: 'Meetings and minutes' }));
    expect(latest[0]).toMatchObject({ modules: { progress: false, meetings: false }, actions: { comment: false, signOff: false, respond: false, download: false } });
    expect(within(mico).getByText('Tick at least one module.')).toBeInTheDocument();
  });

  it('after a save attempt, a project with no module is marked as a problem on its module ticks', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(RIG)]), showErrors: true });
    const rig = await screen.findByRole('group', { name: 'Rig Refit' });
    const progress = within(rig).getByRole('checkbox', { name: 'Progress, milestones and tasks' });
    expect(progress).toHaveAttribute('aria-invalid', 'true');
    expect(progress).toHaveAccessibleDescription('Tick at least one module.');
  });

  it('an archived project they have stays on the list, marked, so saving keeps it', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access({ id: 'p-old', code: 'OLD', name: 'Old Works', company: null }, { modules: { progress: true }, archived: true })]) });
    const old = await screen.findByRole('group', { name: 'Old Works' });
    expect(within(old).getByText('Archived')).toBeInTheDocument();
    expect(within(old).getByText(/hidden in the Client portal/i)).toBeInTheDocument();
    expect(grantsOf(latest)).toEqual([{ projectId: 'p-old', modules: { progress: true, meetings: false }, actions: { comment: false, signOff: false, respond: false, download: false } }]);
  });

  it('with no projects yet, says what that means', async () => {
    clientServer();
    renderEditor();
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });

  it('says so when there is no project to give', async () => {
    clientServer({ options: [] });
    renderEditor();
    await waitFor(() => expect(screen.getByText('There are no projects to give yet.')).toBeInTheDocument());
  });

  it('each tick is finger-sized on a touch screen', async () => {
    clientServer();
    renderEditor({ start: rowsFromAccount([access(FIN, { modules: { meetings: true } })]) });
    const fin = await screen.findByRole('group', { name: 'Finance Office' });
    for (const box of within(fin).getAllByRole('checkbox')) expect(box.closest('label')!.className).toMatch(/\[@media\(pointer:coarse\)\]:!?min-h-11/);
    expect(within(fin).getByRole('button', { name: 'Remove Finance Office' }).className).toMatch(/\[@media\(pointer:coarse\)\]:!?min-h-11/);
  });
});

describe('client-access helpers', () => {
  it('grantsOf sends only the ticks (actions without their module off)', () => {
    const rows = rowsFromAccount([access(MICO, { modules: { meetings: true }, actions: { comment: true, respond: true } })]);
    expect(grantsOf(rows)).toEqual([{ projectId: 'p-mico', modules: { progress: false, meetings: true }, actions: { comment: false, signOff: false, respond: true, download: false } }]);
  });

  it('names the projects with no module', () => {
    const rows = rowsFromAccount([access(MICO), access(RIG, { modules: { progress: true } }), access(FIN)]);
    expect(rowsWithoutModule(rows).map((r) => r.name)).toEqual(['MICO Tower', 'Finance Office']);
    expect(noModuleText(rowsWithoutModule(rows))).toBe('Tick at least one module for MICO Tower and Finance Office: Progress, milestones and tasks, or Meetings and minutes.');
  });
});
