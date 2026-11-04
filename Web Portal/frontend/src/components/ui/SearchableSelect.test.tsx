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
  it('is finger-sized on a touch screen (44px; the md trigger was 38px)', () => {
    render(<SearchableSelect options={opts} value="p2" onChange={() => {}} ariaLabel="Project" />);
    expect(screen.getByRole('button', { name: /project/i }).className).toContain('[@media(pointer:coarse)]:!min-h-11');
  });

  it('shows the whole label on hover when the trigger cuts it short, and only then', () => {
    let cut = true;
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return cut ? 300 : 100; } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 100; } });
    try {
      const { rerender } = render(<SearchableSelect options={opts} value="p3" onChange={() => {}} ariaLabel="Project" />);
      expect(screen.getByText('Rig Inspection Portal')).toHaveAttribute('title', 'Rig Inspection Portal');
      cut = false;
      rerender(<SearchableSelect options={opts} value="p1" onChange={() => {}} ariaLabel="Project" />);
      expect(screen.getByText('Mobile App')).not.toHaveAttribute('title');
    } finally {
      // Back to jsdom's own (inherited from Element.prototype).
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

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

// 1.22 QA: the time list (00:00 … 23:45) opened at 00:00 with the chosen 13:00 out of sight, so people
// scrolled through some fifty rows; the arrow keys could also move the highlight out of view.
describe('SearchableSelect — opening on the chosen option', () => {
  const times = Array.from({ length: 96 }, (_, i) => {
    const t = `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
    return { value: t, label: t };
  });
  it('opens with the chosen option highlighted (Enter keeps it), not the first', async () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={times} value="13:00" onChange={onChange} ariaLabel="Starts: time" />);
    await userEvent.click(screen.getByRole('button', { name: /starts: time/i }));
    const filter = screen.getByRole('combobox', { name: /filter starts: time/i });
    expect(filter).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: '13:00' }).id);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('13:15');
  });
  it('scrolls the list so the chosen option is in sight, and keeps the highlight in sight', async () => {
    const top = (el: Element) => (el.getAttribute('role') === 'listbox' ? 100 : el.getAttribute('role') === 'option' ? 100 + 36 * times.findIndex((t) => t.value === el.textContent) - ((el.closest('[role="listbox"]') as HTMLElement | null)?.scrollTop ?? 0) : 0);
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const t = top(this);
      const h = this.getAttribute('role') === 'listbox' ? 224 : 36;
      return { top: t, bottom: t + h, height: h, left: 0, right: 100, width: 100, x: 0, y: t, toJSON: () => ({}) } as DOMRect;
    });
    // jsdom keeps no scroll position: remember what is set.
    const scrolled = new WeakMap<Element, number>();
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get() { return scrolled.get(this) ?? 0; }, set(v: number) { scrolled.set(this, Math.max(0, v)); } });
    try {
      render(<SearchableSelect options={times} value="13:00" onChange={() => {}} ariaLabel="Starts: time" />);
      await userEvent.click(screen.getByRole('button', { name: /starts: time/i }));
      const list = screen.getByRole('listbox');
      const shown = (name: string) => {
        const r = screen.getByRole('option', { name }).getBoundingClientRect();
        const l = list.getBoundingClientRect();
        return r.top >= l.top && r.bottom <= l.bottom;
      };
      expect(list.scrollTop).toBeGreaterThan(0);
      expect(shown('13:00')).toBe(true);
      for (let i = 0; i < 8; i++) await userEvent.keyboard('{ArrowDown}');
      expect(shown('15:00')).toBe(true);
    } finally {
      spy.mockRestore();
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTop;
    }
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

  it('a chip: a small pill as wide as its words (44px on a touch screen), its list wide enough to read', async () => {
    render(<SearchableSelect size="chip" chipClassName="bg-info-soft text-info" options={opts} value="p2" onChange={() => {}} ariaLabel="Project" />);
    const trigger = screen.getByRole('button', { name: /project/i });
    expect(trigger.className).toMatch(/rounded-full/);
    expect(trigger.className).toMatch(/bg-info-soft/);
    expect(trigger.className).not.toMatch(/(^|\s)w-full(\s|$)/);
    expect(trigger.className).toContain('[@media(pointer:coarse)]:!min-h-11');
    await userEvent.click(trigger);
    const panel = document.querySelector<HTMLElement>('[data-searchable-select-panel]')!;
    expect(panel.style.width).toBe('224px');
  });
});
