import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppreciationPreview, COLOUR_CODE_ERROR, ContentFields } from './AppreciationFields';
import { AppreciationBanner } from './AppreciationBanner';
import { AppreciationIconSvg } from './AppreciationArt';
import { APPRECIATION_ICONS, ICON_LABEL, themeLook } from '../../lib/appreciation';
import type { AppreciationContent, ApiAppreciation } from '../../api/appreciations';

// 1.24.4 (owner, 19 Nov): fourteen colour themes and Custom, twenty icons, and bands that never crash on a value
// they don't know.
const START: AppreciationContent = { title: 'Well done', message: 'Thanks {name}', theme: 'ruby', icon: 'star', animation: 'none' };
let latest: AppreciationContent = START;
function Form({ first = START }: { first?: AppreciationContent }) {
  const [v, setV] = useState(first);
  latest = v;
  return (
    <>
      <ContentFields value={v} onChange={setV} />
      <AppreciationPreview value={v} name="Sara Khan" company={{ name: 'Contoso', logoUrl: null }} day="2026-11-20" sender="Omar Said" />
    </>
  );
}
const colours = () => within(screen.getByRole('group', { name: 'Colour theme' }));
const vars = (el: Element) => (el as HTMLElement).style;

describe('the colour theme', () => {
  it('fourteen named themes and Custom', () => {
    render(<Form />);
    const names = colours().getAllByRole('radio').map((r) => r.closest('label')!.textContent);
    expect(names).toEqual(['Ruby', 'Ocean', 'Emerald', 'Amber', 'Violet', 'Slate', 'Rose', 'Coral', 'Gold', 'Lime', 'Teal', 'Sky', 'Indigo', 'Plum', 'Custom']);
    fireEvent.click(colours().getByRole('radio', { name: 'Plum' }));
    expect(latest.theme).toBe('plum');
  });

  it('Custom: the colour picker and a code box; a typed code (any case) sets the colour, the preview follows', () => {
    const { container } = render(<Form />);
    expect(screen.queryByLabelText('Pick a colour')).toBeNull();
    fireEvent.click(colours().getByRole('radio', { name: 'Custom' }));
    expect(latest.theme).toBe('#1e6091');
    const picker = screen.getByLabelText('Pick a colour') as HTMLInputElement;
    expect(picker.type).toBe('color');
    fireEvent.change(screen.getByLabelText('Or type a colour code'), { target: { value: '#F5F5A0' } });
    expect(latest.theme).toBe('#f5f5a0');
    const preview = container.querySelector('[data-appreciation-preview]')!;
    expect(preview.className).toContain('ap-band');
    expect(vars(preview).getPropertyValue('--ap-l1')).toBe(themeLook('#f5f5a0').light.from);
    expect(vars(preview).getPropertyValue('--ap-li')).toBe('31 26 25'); // dark text on the light colour
    fireEvent.change(picker, { target: { value: '#8b1e1e' } });
    expect(latest.theme).toBe('#8b1e1e');
    expect((screen.getByLabelText('Or type a colour code') as HTMLInputElement).value).toBe('#8B1E1E');
  });

  it('a code that isn’t a colour is refused on leaving the box, and the last good colour is kept', () => {
    render(<Form first={{ ...START, theme: '#1e6091' }} />);
    const box = screen.getByLabelText('Or type a colour code');
    fireEvent.change(box, { target: { value: '#12G' } });
    expect(screen.queryByRole('alert')).toBeNull(); // not while typing
    fireEvent.blur(box);
    expect(screen.getByRole('alert')).toHaveTextContent(COLOUR_CODE_ERROR);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(latest.theme).toBe('#1e6091');
    fireEvent.change(box, { target: { value: '2a9d8f' } });
    expect(latest.theme).toBe('#2a9d8f');
    fireEvent.blur(box);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('back to a named theme and Custom again brings the last custom colour back', () => {
    render(<Form first={{ ...START, theme: '#abcdef' }} />);
    fireEvent.click(colours().getByRole('radio', { name: 'Teal' }));
    expect(latest.theme).toBe('teal');
    fireEvent.click(colours().getByRole('radio', { name: 'Custom' }));
    expect(latest.theme).toBe('#abcdef');
  });
});

describe('the icons', () => {
  it('twenty icon choices, each with its name', () => {
    render(<Form />);
    const icons = within(screen.getByRole('group', { name: 'Icon' })).getAllByRole('radio');
    expect(icons.map((r) => r.getAttribute('aria-label'))).toEqual(APPRECIATION_ICONS.map((i) => ICON_LABEL[i]));
    fireEvent.click(screen.getByRole('radio', { name: 'Handshake' }));
    expect(latest.icon).toBe('handshake');
  });

  it('each draws its own picture; an unknown one draws the star; a label makes it an image with that name', () => {
    const drawn = new Set<string>();
    for (const i of APPRECIATION_ICONS) {
      const { container, unmount } = render(<AppreciationIconSvg icon={i} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('data-icon')).toBe(i);
      expect(svg.children.length).toBeGreaterThan(0);
      drawn.add(svg.innerHTML);
      unmount();
    }
    expect(drawn.size).toBe(20);
    const { container } = render(<AppreciationIconSvg icon={'unicorn' as never} />);
    expect(container.querySelector('svg')!.getAttribute('data-icon')).toBe('star');
    render(<AppreciationIconSvg icon="crown" label="Crown" />);
    expect(screen.getByRole('img', { name: 'Crown' })).toBeInTheDocument();
  });
});

describe('a value the band doesn’t know', () => {
  const A: ApiAppreciation = {
    id: 'ap1', batchId: 'b1', title: 'Great Teamwork', message: 'Thanks', theme: 'neon' as never, icon: 'unicorn' as never, animation: 'none',
    day: '2026-11-18', startsAt: '2026-11-17T20:00:00.000Z', endsAt: '2026-11-18T20:00:00.000Z', status: 'ACTIVE', acceptedAt: null, acceptNote: null, popupClosedAt: null,
    sender: { id: 'u-omar', name: 'Omar Said' }, company: { name: 'Contoso', logoUrl: null },
  };
  it('the banner shows in Ruby with the star (no crash)', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AppreciationBanner a={A} more={0} onAccept={async () => true} problem={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const band = container.querySelector('[data-appreciation-banner]')!;
    expect(vars(band).getPropertyValue('--ap-l1')).toBe(themeLook('ruby').light.from);
    expect(band.querySelector('svg[data-icon]')!.getAttribute('data-icon')).toBe('star');
  });
});
