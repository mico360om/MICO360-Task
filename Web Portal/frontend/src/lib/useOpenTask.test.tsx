import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useOpenTask } from './useOpenTask';
import { useTaskSteps } from './task-steps';

function Probe() {
  const openTask = useOpenTask();
  const loc = useLocation();
  return (
    <>
      <output data-testid="where">{loc.pathname + loc.search}</output>
      <button onClick={() => openTask('t2', ['t1', 't2', 't3'])}>from the list</button>
      <button onClick={() => openTask('t9')}>from nowhere</button>
    </>
  );
}

beforeEach(() => useTaskSteps.getState().clear());

describe('useOpenTask', () => {
  it('opens the task in the address, keeping the page’s own settings, with the list it came from', () => {
    render(
      <MemoryRouter initialEntries={['/board?project=p1']}>
        <Probe />
      </MemoryRouter>,
    );
    act(() => screen.getByText('from the list').click());
    expect(screen.getByTestId('where')).toHaveTextContent('/board?project=p1&task=t2');
    expect(useTaskSteps.getState()).toMatchObject({ ids: ['t1', 't2', 't3'], path: '/board' });
  });

  it('a task opened without a list leaves no list behind', () => {
    render(
      <MemoryRouter initialEntries={['/board']}>
        <Probe />
      </MemoryRouter>,
    );
    act(() => screen.getByText('from the list').click());
    act(() => screen.getByText('from nowhere').click());
    expect(useTaskSteps.getState().ids).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('task=t9');
  });
});
