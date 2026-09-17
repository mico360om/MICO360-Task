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
