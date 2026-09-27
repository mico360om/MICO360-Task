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
});
