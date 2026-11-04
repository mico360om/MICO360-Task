import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DependenciesSection } from './dependencies';

describe('Add a blocker: a task number however it is typed (1.22.3)', () => {
  it('“mico142” offers MICO-142 — not MICO-1420 — and adds it', async () => {
    const onAdd = vi.fn(async () => {});
    render(
      <DependenciesSection
        taskId="t0"
        dependencies={{ blockedBy: [], blocks: [] }}
        availableTasks={[
          { id: 't1420', key: 'MICO-1420', title: 'Longer number' },
          { id: 't142', key: 'MICO-142', title: 'Valve check' },
        ]}
        onAdd={onAdd}
      />,
    );
    await userEvent.type(screen.getByRole('combobox', { name: 'Add a blocking task' }), 'mico142');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('MICO-142')]);
    await userEvent.click(options[0]!);
    expect(onAdd).toHaveBeenCalledWith('t142');
  });
});
