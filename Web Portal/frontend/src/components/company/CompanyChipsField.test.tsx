import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanyChipsField, type CompanyChoice } from './CompanyChipsField';

const alpha: CompanyChoice = { id: 'A', name: 'Alpha Co', logoUrl: null };
const beta: CompanyChoice = { id: 'B', name: 'Beta Co', logoUrl: '/uploads/companies/b/logo.png' };
const gamma: CompanyChoice = { id: 'G', name: 'Gamma Co', logoUrl: null };
const lockedTitle = (name: string) => `Only an administrator or a member of ${name} can change this.`;

/** Each chip's words without its buttons: "Alpha CoMain", "Beta Co". */
const chips = () =>
  within(screen.getByRole('group', { name: 'Companies' }))
    .getAllByRole('listitem')
    .map((li) => {
      const copy = li.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('button').forEach((b) => b.remove());
      return copy.textContent;
    });

function Field({ start, usable, all = [alpha, beta, gamma], onChange = vi.fn(), error }: { start: string[]; usable: CompanyChoice[]; all?: CompanyChoice[]; onChange?: (ids: string[]) => void; error?: string | null }) {
  const [value, setValue] = useState(start);
  return (
    <CompanyChipsField
      value={value}
      onChange={(ids) => {
        setValue(ids);
        onChange(ids);
      }}
      usable={usable}
      all={all}
      lockedTitle={lockedTitle}
      error={error}
    />
  );
}

describe('CompanyChipsField', () => {
  it('shows the companies, the main one first and badged "Main"', () => {
    render(<Field start={['B', 'A']} usable={[alpha, beta]} />);
    expect(screen.getByText('Companies')).toBeInTheDocument();
    expect(chips()).toEqual(['Beta CoMain', 'Alpha Co']);
  });

  it('"Add company" lists the usable companies not yet chosen, A–Z, and adds one at the end', async () => {
    const onChange = vi.fn();
    render(<Field start={['B']} usable={[gamma, beta, alpha]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));
    const menu = screen.getByRole('menu', { name: 'Add company' });
    expect(within(menu).getAllByRole('menuitem').map((o) => o.textContent)).toEqual(['Alpha Co', 'Gamma Co']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Alpha Co' }));
    expect(onChange).toHaveBeenLastCalledWith(['B', 'A']);
    expect(chips()).toEqual(['Beta CoMain', 'Alpha Co']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('the menu works from the keyboard: arrows move, Enter adds, Escape closes back on the button', async () => {
    render(<Field start={['B']} usable={[alpha, beta, gamma]} />);
    const add = screen.getByRole('button', { name: 'Add company' });
    await userEvent.click(add);
    expect(screen.getByRole('menuitem', { name: 'Alpha Co' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Gamma Co' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(add).toHaveFocus();
    await userEvent.click(add);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(chips()).toEqual(['Beta CoMain', 'Gamma Co']);
  });

  it('"Make main" puts a company first; removing one takes it off', async () => {
    const onChange = vi.fn();
    render(<Field start={['B', 'A']} usable={[alpha, beta]} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Make Beta Co the main company' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Make Alpha Co the main company' }));
    expect(onChange).toHaveBeenLastCalledWith(['A', 'B']);
    expect(chips()).toEqual(['Alpha CoMain', 'Beta Co']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Beta Co' }));
    expect(onChange).toHaveBeenLastCalledWith(['A']);
    expect(chips()).toEqual(['Alpha CoMain']);
  });

  it('the last company can’t be taken off: a project needs one', () => {
    render(<Field start={['A']} usable={[alpha, beta]} />);
    expect(screen.getByRole('button', { name: 'Remove Alpha Co' })).toBeDisabled();
    expect(screen.getByTitle('A project needs at least one company.')).toBeInTheDocument();
  });

  it('a company that isn’t usable is locked: no remove, no "Make main", and says who can change it', () => {
    render(<Field start={['A', 'B']} usable={[alpha]} />);
    expect(screen.getByRole('button', { name: 'Remove Beta Co' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Make Beta Co the main company' })).toBeNull();
    expect(screen.getByTitle('Only an administrator or a member of Beta Co can change this.')).toBeInTheDocument();
    // My own company stays mine to change.
    expect(screen.getByRole('button', { name: 'Remove Alpha Co' })).toBeEnabled();
    // Nothing left to add: no "Add company".
    expect(screen.queryByRole('button', { name: 'Add company' })).toBeNull();
  });

  it('a locked main company: my own one may still be made main', async () => {
    const onChange = vi.fn();
    render(<Field start={['B', 'A']} usable={[alpha]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make Alpha Co the main company' }));
    expect(onChange).toHaveBeenLastCalledWith(['A', 'B']);
  });

  it('names a company it doesn’t know as "A company", and puts names in <bdi>', () => {
    render(<Field start={['A', 'X']} usable={[alpha]} all={[alpha]} />);
    expect(chips()).toEqual(['Alpha CoMain', 'A company']);
    expect(screen.getByText('Alpha Co').tagName).toBe('BDI');
  });

  it('shows the server’s refusal under the field, tied to it', () => {
    render(<Field start={['A']} usable={[alpha, beta]} error="You’d lose access to this project. Ask an administrator to make this change." />);
    const msg = screen.getByText('You’d lose access to this project. Ask an administrator to make this change.');
    expect(screen.getByRole('group', { name: 'Companies' })).toHaveAttribute('aria-describedby', expect.stringContaining(msg.id));
  });
});
