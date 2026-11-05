import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MinutesCell, PeopleCell, TitleCell } from './cells';

describe('TitleCell', () => {
  it('turns into a box on a click; Enter saves the new words', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TitleCell value="Pour slab B" what="the title of MICO-12" editable onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Change the title of MICO-12: Pour slab B' }));
    const box = screen.getByRole('textbox', { name: 'The title of MICO-12' });
    expect(box).toHaveValue('Pour slab B');
    await user.clear(box);
    await user.type(box, '  Pour slab C  {Enter}');
    expect(onSave).toHaveBeenCalledWith('Pour slab C');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('saves when the box is left, and not when nothing changed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <>
        <TitleCell value="Pour slab B" what="the title of MICO-12" editable onSave={onSave} />
        <button type="button">elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: /Change the title/ }));
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Change the title/ }));
    await user.type(screen.getByRole('textbox'), ' now');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onSave).toHaveBeenCalledWith('Pour slab B now');
  });

  it('Escape puts the words back', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TitleCell value="Pour slab B" what="the title of MICO-12" editable onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /Change the title/ }));
    await user.type(screen.getByRole('textbox'), ' xyz{Escape}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Change the title/ })).toHaveTextContent('Pour slab B');
  });

  it('refuses an empty title with a short message beside it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TitleCell value="Pour slab B" what="the title of MICO-12" editable onSave={onSave} emptyMessage="A task needs a title." />);
    await user.click(screen.getByRole('button', { name: /Change the title/ }));
    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('A task needs a title.');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('for someone who may not change it, the title opens the task — or is plain words', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { rerender } = render(<TitleCell value="Pour slab B" what="the title of MICO-12" editable={false} openLabel="Open MICO-12: Pour slab B" onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Open MICO-12: Pour slab B' }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<TitleCell value="Pour slab B" what="the title of MICO-12" editable={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Pour slab B')).toBeInTheDocument();
  });
});

describe('MinutesCell', () => {
  it('takes a whole number of minutes, or none', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<MinutesCell value={15} what="the minutes of Site progress" editable onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Change the minutes of Site progress: 15 min' }));
    const box = screen.getByRole('spinbutton', { name: 'The minutes of Site progress' });
    await user.clear(box);
    await user.type(box, '20{Enter}');
    expect(onSave).toHaveBeenLastCalledWith(20);
    await user.click(screen.getByRole('button', { name: /Change the minutes/ }));
    await user.clear(screen.getByRole('spinbutton'));
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenLastCalledWith(null);
  });
  it('is plain words for someone who may not change it', () => {
    render(<MinutesCell value={null} what="the minutes of Site progress" editable={false} onSave={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('PeopleCell', () => {
  const people = [
    { id: 'u1', name: 'Ada Lovelace' },
    { id: 'u2', name: 'Omar Ahmed' },
  ];
  it('shows who is on it and ticks people on and off from a list', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    render(<PeopleCell what="MICO-12" chosen={[people[0]!]} editable people={people} onActivate={onActivate} onToggle={onToggle} />);
    const trigger = screen.getByRole('button', { name: 'People on MICO-12: Ada Lovelace' });
    await user.click(trigger);
    expect(onActivate).toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Ada Lovelace' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Omar Ahmed' }));
    expect(onToggle).toHaveBeenCalledWith({ id: 'u2', name: 'Omar Ahmed' }, true);
    await user.click(screen.getByRole('checkbox', { name: 'Ada Lovelace' }));
    expect(onToggle).toHaveBeenCalledWith({ id: 'u1', name: 'Ada Lovelace' }, false);
  });
  it('says Loading while the list is on its way, and Unassigned for nobody', async () => {
    const user = userEvent.setup();
    render(<PeopleCell what="MICO-12" chosen={[]} editable people={null} onActivate={() => {}} onToggle={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'People on MICO-12: Unassigned' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
  it('is plain names for someone who may not change it', () => {
    render(<PeopleCell what="MICO-12" chosen={people} editable={false} people={null} onActivate={() => {}} onToggle={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Ada Lovelace, Omar Ahmed')).toBeInTheDocument();
  });
});
