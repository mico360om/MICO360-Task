import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from './ui/SearchableSelect';
import { namedProjectOption, projectOption } from './project-option';

const rig = { id: 'p1', code: 'RIP', name: 'Rig Inspection Portal', color: '#1E5A8B', icon: 'rocket', imageUrl: null };
const old = { id: 'p2', code: 'OLD', name: 'Old Project', color: '#8B1E1E' };

describe('projectOption', () => {
  it('is the project’s name and code, with its picture', () => {
    expect(projectOption(rig)).toMatchObject({ value: 'p1', label: 'Rig Inspection Portal', hint: 'RIP' });
  });

  it('shows the picture on the picker and in its list — initials for a project without an icon', async () => {
    render(<SearchableSelect ariaLabel="Project" value="p1" onChange={() => {}} options={[projectOption(rig), projectOption(old)]} />);
    const trigger = screen.getByRole('button', { name: /project/i });
    expect(trigger.querySelector('[data-project-avatar="icon"]')).not.toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByRole('option', { name: /old project/i }).querySelector('[data-project-avatar="initials"]')).toHaveTextContent('OP');
  });

  it('dresses a report row (id and name only) with the project’s picture, or its initials when the project isn’t listed', () => {
    render(
      <SearchableSelect
        ariaLabel="Filter by project"
        value="p1"
        onChange={() => {}}
        options={[namedProjectOption('p1', 'Rig Inspection Portal', [rig]), namedProjectOption('p9', 'Gone Project', [{ id: 'p1' }])]}
      />,
    );
    expect(screen.getByRole('button', { name: /filter by project/i }).querySelector('[data-project-avatar="icon"]')).not.toBeNull();
    expect(namedProjectOption('p9', 'Gone Project', [{ id: 'p1' }])).toMatchObject({ value: 'p9', label: 'Gone Project' });
  });
});
