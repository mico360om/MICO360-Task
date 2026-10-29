import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { Breadcrumbs } from './Breadcrumbs';

describe('PageHeader', () => {
  it('shows the section and the page as one compact line, with the actions beside them', () => {
    render(
      <MemoryRouter>
        <PageHeader eyebrow="Workspace" title="Meetings" subtitle="Plan meetings and follow up." actions={<button type="button">+ New meeting</button>} />
      </MemoryRouter>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Meetings' });
    const line = heading.parentElement!;
    // "Workspace / Meetings", then the description, on the title's own line.
    expect(line.textContent).toBe('Workspace/MeetingsPlan meetings and follow up.');
    expect(screen.getByRole('button', { name: '+ New meeting' })).toBeInTheDocument();
  });

  it('when the line is short of room, the description gives way before the title (it squeezed “Reports” to “Re…”)', () => {
    render(<PageHeader eyebrow="Admin" title="Reports" subtitle="Task delivery, project progress and team workload." actions={<button type="button">Export</button>} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Reports' });
    const description = screen.getByText(/Task delivery/);
    // A grid: the title's column is sized to the title (auto) before the description's 0–1fr column
    // gets what is left, so the description is cut first.
    const line = heading.parentElement!;
    expect(line.className).toMatch(/grid-cols-\[auto_auto_auto_minmax\(0,1fr\)\]/);
    expect(line.lastElementChild).toBe(description);
  });

  it('keeps the title whole beside its actions: the actions move under it when both don’t fit (“User & Profile Managem…” at 768px)', () => {
    render(<PageHeader eyebrow="Admin" title="User & Profile Management" subtitle="Accounts, roles and access." actions={<button type="button">New user</button>} />);
    const line = screen.getByRole('heading', { level: 1 }).parentElement!;
    // The title line asks for its own full width (flex-basis auto) before sharing the row…
    expect(line.className).toMatch(/flex-\[1_1_auto\]/);
    // …and the description adds nothing to that width (it only fills what is left).
    expect(screen.getByText('Accounts, roles and access.').className).toMatch(/\[contain:inline-size\]/);
  });

  it('works without a section or a subtitle', () => {
    render(<PageHeader title="Your profile" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Your profile' }).parentElement!.textContent).toBe('Your profile');
  });
});

describe('Breadcrumbs', () => {
  it('links the way back and marks the current page', () => {
    render(
      <MemoryRouter>
        <Breadcrumbs items={[{ label: 'Meetings', to: '/meetings' }, { label: 'Weekly sync' }]} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Meetings' }).getAttribute('href')).toBe('/meetings');
    const current = within(nav).getByText('Weekly sync');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getAllByRole('listitem')).toHaveLength(2);
  });

  it('gives the current page’s crumb its whole name on hover when it is cut short', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return 400; } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 120; } });
    try {
      render(
        <MemoryRouter>
          <Breadcrumbs items={[{ label: 'Meetings', to: '/meetings' }, { label: 'Reliability review — a very long meeting title' }]} />
        </MemoryRouter>,
      );
      expect(screen.getByText('Reliability review — a very long meeting title')).toHaveAttribute('title', 'Reliability review — a very long meeting title');
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });
});
