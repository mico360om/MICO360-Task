import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useTaskStepper } from './useTaskStepper';
import { useTaskSteps } from './task-steps';

function Probe() {
  const loc = useLocation();
  const navigate = useNavigate();
  const taskId = new URLSearchParams(loc.search).get('task');
  const stepper = useTaskStepper(taskId);
  return (
    <>
      <output data-testid="where">{loc.pathname + loc.search}</output>
      <output data-testid="place">{stepper ? `${stepper.position} of ${stepper.total}` : 'none'}</output>
      <button disabled={!stepper?.onPrevious} onClick={() => stepper?.onPrevious?.()}>previous</button>
      <button disabled={!stepper?.onNext} onClick={() => stepper?.onNext?.()}>next</button>
      <button onClick={() => navigate(-1)}>back</button>
    </>
  );
}

const asked: string[] = [];
function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/board?project=p1', path]} initialIndex={1}>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  asked.length = 0;
  useTaskSteps.getState().clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ data: { id: 'x' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('useTaskStepper — the panel’s steps through the list a task came from', () => {
  it('says where the task is, and steps through the address so Back goes back', () => {
    useTaskSteps.getState().open(['t1', 't2', 't3'], '/board');
    renderAt('/board?project=p1&task=t2');
    expect(screen.getByTestId('place')).toHaveTextContent('2 of 3');
    act(() => screen.getByText('next').click());
    expect(screen.getByTestId('where')).toHaveTextContent('/board?project=p1&task=t3');
    expect(screen.getByTestId('place')).toHaveTextContent('3 of 3');
    expect(screen.getByText('next')).toBeDisabled();
    expect(useTaskSteps.getState().stepped).toBe('next');
    act(() => screen.getByText('back').click());
    expect(screen.getByTestId('where')).toHaveTextContent('task=t2');
    act(() => screen.getByText('previous').click());
    expect(screen.getByTestId('where')).toHaveTextContent('task=t1');
    expect(screen.getByText('previous')).toBeDisabled();
  });

  it('reads the neighbours ahead, so a step opens at once', async () => {
    useTaskSteps.getState().open(['t1', 't2', 't3'], '/board');
    renderAt('/board?project=p1&task=t2');
    await vi.waitFor(() => expect(asked.some((u) => u.endsWith('/tasks/t3'))).toBe(true));
    expect(asked.some((u) => u.endsWith('/tasks/t1'))).toBe(true);
  });

  it('no steps for a task from no list, or once the page it came from is left', () => {
    renderAt('/board?task=t2');
    expect(screen.getByTestId('place')).toHaveTextContent('none');
    useTaskSteps.getState().open(['t1', 't2'], '/my-tasks');
    renderAt('/board?task=t2');
    expect(screen.getAllByTestId('place').at(-1)).toHaveTextContent('none');
  });
});
