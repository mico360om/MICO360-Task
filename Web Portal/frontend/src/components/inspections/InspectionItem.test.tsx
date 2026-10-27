import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { InspectionItem } from './InspectionItem';
import type { FormItem } from '../../lib/inspection-rules';

const pressure: FormItem = { id: 'p', kind: 'READING', label: 'Pressure', help: 'At the well head gauge', unit: 'psi', min: 0, max: 150 };
const valves: FormItem = { id: 'v', kind: 'CHECK', label: 'Valves closed', help: null };

const renderItem = (props: Partial<Parameters<typeof InspectionItem>[0]> = {}) => {
  const onAnswer = vi.fn();
  const onMakeFollowUp = vi.fn();
  render(
    <MemoryRouter>
      <InspectionItem item={valves} number={2} answer={undefined} readOnly={false} onAnswer={onAnswer} onMakeFollowUp={onMakeFollowUp} canMakeFollowUp {...props} />
    </MemoryRouter>,
  );
  return { onAnswer, onMakeFollowUp };
};

describe('a Pass / Fail / N/A item', () => {
  it('saves the choice (a radio group named after the item)', async () => {
    const { onAnswer } = renderItem();
    const group = screen.getByRole('radiogroup', { name: 'Valves closed' });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Fail' }));
    expect(onAnswer).toHaveBeenCalledWith({ result: 'FAIL', reading: null, note: null });
  });

  it('keeps the note with the result', async () => {
    const { onAnswer } = renderItem({ answer: { itemId: 'v', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:00:00Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add a note: Valves closed' }));
    const note = screen.getByRole('textbox', { name: 'Note: Valves closed' });
    await userEvent.type(note, 'Leaking at the flange');
    fireEvent.blur(note);
    expect(onAnswer).toHaveBeenLastCalledWith({ result: 'FAIL', reading: null, note: 'Leaking at the flange' });
  });
});

describe('a reading', () => {
  it('works its result out from the limits as it is typed, and saves it', async () => {
    const { onAnswer } = renderItem({ item: pressure });
    expect(screen.getByText('Allowed 0–150 psi')).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Pressure, reading in psi' });
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(input, '162.5');
    expect(screen.getByText('Outside the allowed 0–150 psi')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
    fireEvent.blur(input);
    expect(onAnswer).toHaveBeenCalledWith({ result: null, reading: '162.5', note: null });
  });

  it('refuses something that isn’t a number, and saves nothing', async () => {
    const { onAnswer } = renderItem({ item: pressure });
    const input = screen.getByRole('textbox', { name: 'Pressure, reading in psi' });
    await userEvent.type(input, '12 psi');
    fireEvent.blur(input);
    expect(screen.getByText('Enter the reading as a number, like 12.5')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('can be marked N/A (or failed) when it can’t be taken', async () => {
    const { onAnswer } = renderItem({ item: pressure });
    await userEvent.click(screen.getByRole('button', { name: 'N/A: Pressure' }));
    expect(onAnswer).toHaveBeenCalledWith({ result: 'NA', reading: null, note: null });
    await userEvent.click(screen.getByRole('button', { name: 'Couldn’t take it (fail): Pressure' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ result: 'FAIL', reading: null, note: null });
  });
});

describe('read-only, and follow-ups', () => {
  it('shows the answer without controls when it can’t be changed', () => {
    renderItem({ item: pressure, readOnly: true, answer: { itemId: 'p', result: 'FAIL', reading: '162.5', note: 'Gauge high', editedAt: '2026-10-27T08:00:00Z' } });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('162.5 psi')).toBeInTheDocument();
    expect(screen.getByText('Gauge high')).toBeInTheDocument();
  });

  it('offers a follow-up task for a failed item, or links the one made', async () => {
    const { onMakeFollowUp } = renderItem({ answer: { itemId: 'v', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:00:00Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Make a follow-up task: Valves closed' }));
    expect(onMakeFollowUp).toHaveBeenCalled();
  });

  it('links an existing follow-up task, and says when one waits to be made', () => {
    renderItem({
      readOnly: true,
      answer: { itemId: 'v', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:00:00Z' },
      followUp: { task: { id: 't1', key: 'RIG-12', title: 'Follow up: Valves closed', deleted: false, done: false }, pending: false, queued: false },
    });
    expect(screen.getByRole('link', { name: /RIG-12/ })).toHaveAttribute('href', '/?task=t1');
  });

  it('says when a follow-up task will be made once back online', () => {
    renderItem({ answer: { itemId: 'v', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:00:00Z' }, followUp: { task: null, pending: false, queued: true } });
    expect(screen.getByText('Follow-up task saved on this phone: it’s made when you’re back online.')).toBeInTheDocument();
  });
});
