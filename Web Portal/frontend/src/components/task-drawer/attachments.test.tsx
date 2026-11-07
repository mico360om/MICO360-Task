import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { AttachmentsSection, type DrawerAttachment } from './attachments';

const FILES: DrawerAttachment[] = [
  { id: 'a1', filename: 'spec.pdf', url: '/uploads/a1.pdf', sizeBytes: 2048, mimeType: 'application/pdf', clientVisible: false },
  { id: 'a2', filename: 'site-photo.jpg', url: '/uploads/a2.jpg', sizeBytes: 4096, mimeType: 'image/jpeg', fromClient: true, clientVisible: false },
  { id: 'a3', filename: 'drawing.pdf', url: '/uploads/a3.pdf', sizeBytes: 900, mimeType: 'application/pdf', clientVisible: true },
];
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('li')!;

/** The section as the drawer holds it: the list follows what was saved. */
function Saved({ onSave, taskShown = true }: { onSave: (id: string, visible: boolean) => Promise<void>; taskShown?: boolean }) {
  const [files, setFiles] = useState(FILES);
  return (
    <AttachmentsSection
      attachments={files}
      taskShownToClient={taskShown}
      onSetClientVisible={async (id, visible) => {
        await onSave(id, visible);
        setFiles((list) => list.map((f) => (f.id === id ? { ...f, clientVisible: visible } : f)));
      }}
    />
  );
}

describe('Attachments: files and clients (1.23.7)', () => {
  it('a file a client uploaded in the Client portal is marked “From client” (as a client’s comment is marked); the team’s files aren’t', () => {
    render(<AttachmentsSection attachments={FILES} />);
    const badge = within(rowOf('site-photo.jpg')).getByText('From client');
    expect(badge).toHaveAttribute('data-tone', 'info');
    expect(within(rowOf('spec.pdf')).queryByText('From client')).not.toBeInTheDocument();
  });

  it('for whoever may show things to clients: every file has its own “Show to client” tick, named after the file, with one hint saying where clients see it', () => {
    render(<Saved onSave={vi.fn(async () => {})} />);
    const spec = screen.getByRole('checkbox', { name: 'Show to client: spec.pdf' });
    expect(spec).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show to client: site-photo.jpg' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show to client: drawing.pdf' })).toBeChecked();
    // One hint for the section, read with each tick.
    expect(spec).toHaveAccessibleDescription(/Client portal/);
    expect(spec).toHaveAccessibleDescription(/only while this task is shown to clients/);
    // A client's own file: its uploader sees it anyway (the tick is for the project's other clients).
    expect(spec).toHaveAccessibleDescription(/A client always sees their own files/);
    expect(screen.getAllByText(/Client portal/)).toHaveLength(1);
    // A 44px target on a touch screen.
    expect(spec.closest('label')!.className).toContain('[@media(pointer:coarse)]:!min-h-11');
  });

  it('the hint says so when the task itself isn’t shown to clients yet', () => {
    render(<Saved onSave={vi.fn(async () => {})} taskShown={false} />);
    expect(screen.getByRole('checkbox', { name: 'Show to client: spec.pdf' })).toHaveAccessibleDescription(/This task isn’t shown to clients now/);
  });

  it('with no client’s file on the task, the hint says nothing about clients’ own files', () => {
    render(<AttachmentsSection attachments={[FILES[0]!]} onSetClientVisible={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Show to client: spec.pdf' })).not.toHaveAccessibleDescription(/their own files/);
  });

  it('a tick shows at once and is saved; the box stays ticked once saved', async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<Saved onSave={onSave} />);
    const spec = screen.getByRole('checkbox', { name: 'Show to client: spec.pdf' });
    await userEvent.click(spec);
    expect(onSave).toHaveBeenCalledWith('a1', true);
    expect(spec).toBeChecked(); // at once, while it saves
    expect(spec).toBeDisabled();
    finish();
    await waitFor(() => expect(spec).toBeEnabled());
    expect(spec).toBeChecked();
    // Untick a shown one.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show to client: drawing.pdf' }));
    expect(onSave).toHaveBeenLastCalledWith('a3', false);
  });

  it('a refusal puts the tick back and says why, in the server’s words', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('Only the project manager or an administrator can show a file to clients.');
    });
    render(<Saved onSave={onSave} />);
    const spec = screen.getByRole('checkbox', { name: 'Show to client: spec.pdf' });
    await userEvent.click(spec);
    expect(await within(rowOf('spec.pdf')).findByRole('alert')).toHaveTextContent('Only the project manager or an administrator can show a file to clients.');
    expect(spec).not.toBeChecked();
    expect(spec).toBeEnabled();
  });

  it('for everyone else: no ticks and no hint; a file shown to clients says so, the others say nothing', () => {
    render(<AttachmentsSection attachments={FILES} />);
    expect(screen.queryByRole('checkbox', { name: /show to client/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Client portal/)).not.toBeInTheDocument();
    expect(within(rowOf('drawing.pdf')).getByText('Shown to client')).toBeInTheDocument();
    expect(within(rowOf('spec.pdf')).queryByText('Shown to client')).not.toBeInTheDocument();
    expect(within(rowOf('site-photo.jpg')).queryByText('Shown to client')).not.toBeInTheDocument();
  });

  it('an older server (no word on clients): nothing about clients at all', () => {
    render(<AttachmentsSection attachments={[{ id: 'a1', filename: 'spec.pdf', url: '/uploads/a1.pdf', sizeBytes: 2048 }]} />);
    expect(screen.queryByText(/client/i)).not.toBeInTheDocument();
  });
});
