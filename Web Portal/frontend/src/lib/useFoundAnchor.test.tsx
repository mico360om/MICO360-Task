import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { markFound, useFoundAnchor } from './useFoundAnchor';

afterEach(() => vi.useRealTimers());

function Page({ ready, show }: { ready: boolean; show: boolean }) {
  useFoundAnchor(ready);
  return show ? <li id="note-n1">Gas test</li> : null;
}

describe('useFoundAnchor (a search result’s place on a page)', () => {
  it('brings the element the address names (#note-…) into view and marks it for a moment, once it is there', async () => {
    vi.useFakeTimers();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    function Later() {
      const [show, setShow] = useState(false);
      return (
        <>
          <button onClick={() => setShow(true)}>load</button>
          <Page ready show={show} />
        </>
      );
    }
    const { getByText, container } = render(
      <MemoryRouter initialEntries={['/meetings/m1#note-n1']}>
        <Later />
      </MemoryRouter>,
    );
    // The notes come a moment later: it keeps looking.
    act(() => getByText('load').click());
    await act(async () => void vi.advanceTimersByTime(400));
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(container.querySelector('#note-n1')).toHaveAttribute('data-found', 'true');
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(container.querySelector('#note-n1')).not.toHaveAttribute('data-found');
  });

  it('markFound marks an element for a moment', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    markFound(el);
    expect(el.getAttribute('data-found')).toBe('true');
    vi.advanceTimersByTime(3000);
    expect(el.hasAttribute('data-found')).toBe(false);
  });
});
