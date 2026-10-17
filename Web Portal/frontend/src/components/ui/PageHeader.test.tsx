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
});
