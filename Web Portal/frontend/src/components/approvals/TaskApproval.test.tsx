import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskApproval } from './TaskApproval';
import type { ApiTask } from '../../api/tasks';

const base: ApiTask = {
  id: 't1', key: 'RIG-4', title: 'Pressure test report', description: null, projectId: 'p1', columnId: 'doing', columnCategory: 'IN_PROGRESS', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: null, progress: 40, completedAt: null, createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z', version: 3,
};
const waiting: ApiTask = {
  ...base,
  columnId: 'review',
  columnCategory: 'REVIEW',
  needsApproval: true,
  approvalRequestedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  approvalRequestedById: 'sara',
  approval: { canApprove: true, requestedBy: { id: 'sara', name: 'سارة البلوشي' }, approvedBy: null, approverName: 'Omar Ahmed' },
};

describe('the task panel’s approval section', () => {
  it('a task that doesn’t need approval: the tick, off, with its one-line hint', async () => {
    const onSet = vi.fn(async () => {});
    render(<TaskApproval task={base} onSetNeedsApproval={onSet} />);
    const tick = screen.getByRole('switch', { name: 'Needs approval' });
    expect(tick).toHaveAttribute('aria-checked', 'false');
    expect(tick).toHaveAccessibleDescription('A project manager must approve it before it counts as done.');
    await userEvent.click(tick);
    expect(onSet).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('approval-chip')).toBeNull();
  });

  it('waiting, for an approver: the badge, who finished it, and Approve / Send back', async () => {
    const onApprove = vi.fn(async () => {});
    render(<TaskApproval task={waiting} onApprove={onApprove} onSendBack={vi.fn()} onSetNeedsApproval={vi.fn()} />);
    expect(screen.getByTestId('approval-chip')).toHaveTextContent('Waiting for approval');
    expect(screen.getByText(/Finished by/)).toHaveTextContent('Finished by سارة البلوشي · 2h ago');
    expect(screen.getByText('سارة البلوشي').tagName).toBe('BDI');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('waiting, for anyone else: whose approval it waits for, no buttons, and the tick can’t be turned off', () => {
    render(<TaskApproval task={{ ...waiting, approval: { ...waiting.approval!, canApprove: false } }} onApprove={vi.fn()} onSendBack={vi.fn()} onSetNeedsApproval={vi.fn()} />);
    expect(screen.getByText('Waiting for Omar Ahmed’s approval')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Needs approval' })).toBeDisabled();
    expect(screen.getByText('Only the project’s managers can turn this off.')).toBeInTheDocument();
  });

  it('ticked (not waiting) for someone who doesn’t run the project: shown on, can’t be turned off, and says why — to a screen reader too (owner, 30 Oct)', async () => {
    const onSet = vi.fn(async () => {});
    render(<TaskApproval task={{ ...base, needsApproval: true, approval: { canApprove: false, requestedBy: null, approvedBy: null, approverName: 'Omar Ahmed' } }} onSetNeedsApproval={onSet} />);
    const tick = screen.getByRole('switch', { name: 'Needs approval' });
    expect(tick).toHaveAttribute('aria-checked', 'true');
    expect(tick).toBeDisabled();
    expect(tick).toHaveAccessibleDescription('A project manager must approve it before it counts as done. Only the project’s managers can turn this off.');
    await userEvent.click(tick);
    expect(onSet).not.toHaveBeenCalled();
  });

  it('ticked (not waiting) for whoever runs the project: they can turn it off, with no warning line', async () => {
    const onSet = vi.fn(async () => {});
    render(<TaskApproval task={{ ...base, needsApproval: true, approval: { canApprove: true, requestedBy: null, approvedBy: null, approverName: 'Omar Ahmed' } }} onSetNeedsApproval={onSet} />);
    const tick = screen.getByRole('switch', { name: 'Needs approval' });
    expect(tick).toBeEnabled();
    expect(screen.queryByText('Only the project’s managers can turn this off.')).toBeNull();
    await userEvent.click(tick);
    expect(onSet).toHaveBeenCalledWith(false);
  });

  it('not ticked, for someone who doesn’t run the project: they can still turn it on', async () => {
    const onSet = vi.fn(async () => {});
    render(<TaskApproval task={{ ...base, approval: { canApprove: false, requestedBy: null, approvedBy: null, approverName: null } }} onSetNeedsApproval={onSet} />);
    const tick = screen.getByRole('switch', { name: 'Needs approval' });
    expect(tick).toBeEnabled();
    await userEvent.click(tick);
    expect(onSet).toHaveBeenCalledWith(true);
  });

  it('several people run the project: "a project manager’s approval"', () => {
    render(<TaskApproval task={{ ...waiting, approval: { ...waiting.approval!, canApprove: false, approverName: null } }} />);
    expect(screen.getByText('Waiting for a project manager’s approval')).toBeInTheDocument();
  });

  it('send back asks for a reason (required), and Cancel or Escape keeps things as they are', async () => {
    const onSendBack = vi.fn(async () => {});
    render(<TaskApproval task={waiting} onApprove={vi.fn()} onSendBack={onSendBack} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }));
    const dialog = screen.getByRole('dialog', { name: 'Send RIG-4 back?' });
    expect(dialog).toBeInTheDocument();
    const box = screen.getByLabelText('Why are you sending it back?');
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    expect(onSendBack).not.toHaveBeenCalled();
    expect(screen.getByText('Write a reason first.')).toBeInTheDocument();
    expect(box).toHaveFocus(); // back in the box, to type the reason
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await userEvent.type(screen.getByLabelText('Why are you sending it back?'), '  Add the gauge readings ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSendBack).toHaveBeenCalledWith('Add the gauge readings');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a send-back that fails keeps the dialog open with the reason and says why', async () => {
    const onSendBack = vi.fn(async () => {
      throw new Error('This task isn’t waiting for approval any more.');
    });
    render(<TaskApproval task={waiting} onApprove={vi.fn()} onSendBack={onSendBack} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await userEvent.type(screen.getByLabelText('Why are you sending it back?'), 'Redo');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send back' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This task isn’t waiting for approval any more.');
    expect(screen.getByLabelText('Why are you sending it back?')).toHaveValue('Redo');
  });

  it('an approver turning approval off while it waits is asked first: it will be marked done', async () => {
    const onSet = vi.fn(async () => {});
    render(<TaskApproval task={waiting} onApprove={vi.fn()} onSendBack={vi.fn()} onSetNeedsApproval={onSet} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Needs approval' }));
    expect(screen.getByRole('alertdialog', { name: 'Turn off approval?' })).toHaveTextContent('marks it done now');
    await userEvent.click(screen.getByRole('button', { name: 'Turn off and mark done' }));
    expect(onSet).toHaveBeenCalledWith(false);
  });

  it('turning approval off that fails keeps the question open and says why', async () => {
    const onSet = vi.fn(async () => {
      throw new Error('Only the project’s managers can turn off approval for this task.');
    });
    render(<TaskApproval task={waiting} onApprove={vi.fn()} onSendBack={vi.fn()} onSetNeedsApproval={onSet} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Needs approval' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn off and mark done' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off approval?' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only the project’s managers');
  });

  it('approved: says who approved it', () => {
    render(<TaskApproval task={{ ...base, needsApproval: true, columnCategory: 'DONE', completedAt: '2026-10-30T08:00:00Z', approvedAt: '2026-10-30T08:00:00Z', approval: { canApprove: false, requestedBy: null, approvedBy: { id: 'omar', name: 'Omar Ahmed' }, approverName: null } }} />);
    expect(screen.getByText(/Approved by/)).toHaveTextContent('Approved by Omar Ahmed');
  });
});
