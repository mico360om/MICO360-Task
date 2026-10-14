import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from './SearchableSelect';

const opts = [
  { value: 'p1', label: 'Mobile App' },
  { value: 'p2', label: 'Finance Automation' },
  { value: 'p3', label: 'Rig Inspection Portal' },
];

describe('SearchableSelect', () => {
  it('shows the selected option label on the trigger', () => {
    render(<SearchableSelect options={opts} value="p2" onChange={() => {}} ariaLabel="Project" />);
    expect(screen.getByRole('button', { name: /project/i })).toHaveTextContent('Finance Automation');
  });

  it('shows the placeholder when nothing is selected', () => {
    render(<SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" placeholder="Pick a project" />);
    expect(screen.getByRole('button', { name: /project/i })).toHaveTextContent('Pick a project');
  });

  it('filters options as you type and selects a match by click', async () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={opts} value="" onChange={onChange} ariaLabel="Project" />);
    await userEvent.click(screen.getByRole('button', { name: /project/i }));
    await userEvent.type(screen.getByPlaceholderText(/type to filter/i), 'rig');
    expect(screen.getByRole('option', { name: /Rig Inspection Portal/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Finance Automation/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Rig Inspection Portal/i }));
    expect(onChange).toHaveBeenCalledWith('p3');
  });

  it('selects with the keyboard (arrow down + enter)', async () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={opts} value="" onChange={onChange} ariaLabel="Project" />);
    await userEvent.click(screen.getByRole('button', { name: /project/i }));
    await userEvent.type(screen.getByPlaceholderText(/type to filter/i), '{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('returns focus to the trigger after a keyboard choice (WEB-16)', async () => {
    render(<SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" />);
    const trigger = screen.getByRole('button', { name: /project/i });
    await userEvent.click(trigger);
    expect(screen.getByPlaceholderText(/type to filter/i)).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('returns focus to the trigger after a click choice or Escape (WEB-16)', async () => {
    render(<SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" />);
    const trigger = screen.getByRole('button', { name: /project/i });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('option', { name: /mobile app/i }));
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Tab and hands focus back to the trigger so tabbing continues through the form (WEB-16)', async () => {
    render(
      <>
        <SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" />
        <button type="button">Next field</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /project/i }));
    await userEvent.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next field/i })).toHaveFocus();
  });

  it('shows an empty-state when no option matches', async () => {
    render(<SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" />);
    await userEvent.click(screen.getByRole('button', { name: /project/i }));
    await userEvent.type(screen.getByPlaceholderText(/type to filter/i), 'zzz');
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('portals the dropdown panel to document.body so it escapes card stacking/overflow', async () => {
    render(<SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" />);
    await userEvent.click(screen.getByRole('button', { name: /project/i }));
    const panel = document.querySelector('[data-searchable-select-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).toBe(document.body);
  });

  it('is a valid listbox for screen readers: options sit directly in it, and the filter box names the highlighted one', async () => {
    render(<SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" />);
    await userEvent.click(screen.getByRole('button', { name: /project/i }));
    const listbox = screen.getByRole('listbox');
    // The <li> wrappers are presentational, so the listbox's children are its options.
    for (const li of listbox.querySelectorAll('li')) expect(li).toHaveAttribute('role', 'presentation');
    const filter = screen.getByRole('combobox', { name: /filter project/i });
    const options = screen.getAllByRole('option');
    expect(filter).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await userEvent.keyboard('{ArrowDown}');
    expect(filter).toHaveAttribute('aria-activedescendant', options[1]!.id);
  });
});

describe('SearchableSelect — pictures and errors', () => {
  it('shows an option’s picture in the list and on the trigger', async () => {
    const withIcons = opts.map((o) => ({ ...o, icon: <span data-testid={`icon-${o.value}`} /> }));
    render(<SearchableSelect options={withIcons} value="p2" onChange={() => {}} ariaLabel="Project" />);
    const trigger = screen.getByRole('button', { name: /project/i });
    expect(trigger.querySelector('[data-testid="icon-p2"]')).not.toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByRole('option', { name: /Rig Inspection Portal/i }).querySelector('[data-testid="icon-p3"]')).not.toBeNull();
  });

  it('can be marked invalid and point at its error message', () => {
    render(<SearchableSelect options={opts} value="" onChange={() => {}} ariaLabel="Project" invalid describedBy="project-error" />);
    const trigger = screen.getByRole('button', { name: /project/i });
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', 'project-error');
  });
});
