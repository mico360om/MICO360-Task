import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProjectCard, type ProjectCardProps } from './ProjectCard';
import type { ProjectOverview, ProjectStats } from '../../api/projects';

const NOW = new Date('2026-10-23T10:00:00Z'); // Friday, 14:00 in Muscat
const TODAY = '2026-10-23';
const person = (id: string, name: string) => ({ id, name, avatarUrl: null });

function project(extra: Partial<Omit<ProjectOverview, 'stats'>> & { stats?: Partial<ProjectStats> } = {}): ProjectOverview {
  const { stats, ...rest } = extra;
  return {
    id: 'p1',
    code: 'RIG',
    number: 'C-2041',
    name: 'Rig Inspection Portal',
    description: null,
    clientName: 'Gulf Energy',
    status: 'ACTIVE',
    priority: 'NORMAL',
    color: '#3A6EA5',
    icon: null,
    imageUrl: null,
    ownerId: 'u1',
    managerId: null,
    startDate: null,
    targetDate: '2026-11-30T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    owner: person('u1', 'Sara Ahmed'),
    team: [person('u1', 'Sara Ahmed'), person('u2', 'Omar Said')],
    ...rest,
    stats: { total: 40, done: 25, open: 15, overdue: 4, nextDue: '2026-10-26', lastActivityAt: '2026-10-23T08:00:00.000Z', ...stats },
  };
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderCard(props: Partial<ProjectCardProps> = {}) {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="*" element={<><ProjectCard project={project()} today={TODAY} now={NOW} timeZone="Asia/Muscat" {...props} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!;

describe('ProjectCard', () => {
  it('names the project as the link that opens it, with code · number · client underneath', () => {
    renderCard();
    expect(screen.getByRole('link', { name: 'Rig Inspection Portal' })).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByTestId('project-meta')).toHaveTextContent('RIG · No. C-2041 · Gulf Energy');
  });

  it('leaves out the number and client when they aren’t set', () => {
    renderCard({ project: project({ number: null, clientName: null }) });
    expect(screen.getByTestId('project-meta').textContent).toBe('RIG');
  });

  it('shows progress, the last update and the three figures', () => {
    renderCard();
    expect(screen.getByTestId('project-progress')).toHaveTextContent('62% done · 25 of 40 tasks');
    expect(screen.getByText('Updated 2 h ago')).toBeInTheDocument();
    expect(figure('Open')).toHaveTextContent('15');
    expect(figure('Overdue')).toHaveTextContent('4');
    expect(figure('Next due')).toHaveTextContent('Mon 26');
    // The full day is there for screen readers.
    expect(within(figure('Next due')).getByText('Monday 26 October 2026')).toHaveClass('sr-only');
  });

  it('paints Overdue red only when something is overdue, and shows a dash when nothing is due', () => {
    const { unmount } = renderCard();
    expect(figure('Overdue')).toHaveAttribute('data-late', 'true');
    unmount();
    renderCard({ project: project({ stats: { overdue: 0, nextDue: null } }) });
    expect(figure('Overdue')).toHaveAttribute('data-late', 'false');
    expect(figure('Next due')).toHaveTextContent('—');
  });

  it('shows up to four team faces and how many more, the owner and the target date', () => {
    const team = ['Sara Ahmed', 'Omar Said', 'Hassan Ali', 'Zara Noor', 'Adam Khan', 'Lina Haddad'].map((n, i) => person(`u${i + 1}`, n));
    renderCard({ project: project({ team }) });
    const faces = screen.getByTestId('project-team');
    expect(faces.querySelectorAll('[data-face]')).toHaveLength(4);
    expect(faces).toHaveTextContent('+2');
    expect(within(faces).getByText('Team: Sara Ahmed, Omar Said, Hassan Ali, Zara Noor and 2 more')).toHaveClass('sr-only');
    expect(screen.getByTestId('project-owner')).toHaveTextContent('Owner · Sara Ahmed');
    expect(screen.getByText('Target 30 Nov · 38 days')).toBeInTheDocument();
  });

  it('says when there is no owner, no team or no target, and shows a passed target in red', () => {
    renderCard({ project: project({ ownerId: null, owner: null, team: [], targetDate: '2026-10-20T00:00:00.000Z' }) });
    expect(screen.getByTestId('project-owner')).toHaveTextContent('No owner');
    expect(screen.queryByTestId('project-team')).not.toBeInTheDocument();
    expect(screen.getByText('Target passed 3 days ago')).toHaveAttribute('data-late', 'true');
  });

  it('shows the project’s picture, else its icon on its colour, else its initials', () => {
    const { unmount } = renderCard();
    expect(document.querySelector('[data-project-avatar]')).toHaveAttribute('data-project-avatar', 'initials');
    expect(document.querySelector('[data-project-avatar]')).toHaveTextContent('RI');
    unmount();
    renderCard({ project: project({ imageUrl: '/uploads/projects/logo.webp' }) });
    expect(document.querySelector('[data-project-avatar]')).toHaveAttribute('data-project-avatar', 'image');
  });

  it('draws initials as large text (over 14pt, bold), so they stay readable on every colour on offer', () => {
    renderCard({ project: project({ color: '#B7791F' }) });
    const tile = document.querySelector('[data-project-avatar="initials"]')!;
    expect(tile.className).toMatch(/(^|\s)!text-\[1\.2rem\](\s|$)/);
    expect(tile.className).toMatch(/font-bold/);
  });

  it('gives someone who may manage it a status menu, and others a plain status', async () => {
    const onChangeStatus = vi.fn();
    const { unmount } = renderCard({ onChangeStatus });
    await userEvent.click(screen.getByRole('button', { name: /status: active/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'On hold' }));
    expect(onChangeStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'ON_HOLD');
    unmount();
    renderCard();
    expect(screen.queryByRole('button', { name: /status/i })).not.toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('“⋯” holds Edit, Open board and Archive for a manager', async () => {
    const onEdit = vi.fn();
    const onArchive = vi.fn();
    renderCard({ onEdit, onArchive, onChangeStatus: vi.fn() });
    const more = screen.getByRole('button', { name: 'More actions for Rig Inspection Portal' });
    await userEvent.click(more);
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Open board', 'Archive…']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    await userEvent.click(more);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive…' }));
    expect(onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    await userEvent.click(more);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open board' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/board?project=p1');
  });

  it('“⋯” only opens the board for everyone else, and never offers Archive on an archived project', async () => {
    const { unmount } = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Rig Inspection Portal' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open board']);
    unmount();
    renderCard({ project: project({ status: 'ARCHIVED' }), onEdit: vi.fn(), onArchive: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Rig Inspection Portal' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Open board']);
  });

  it('keeps its buttons out of the link (no nested controls)', () => {
    renderCard({ onEdit: vi.fn(), onArchive: vi.fn(), onChangeStatus: vi.fn() });
    const link = screen.getByRole('link', { name: 'Rig Inspection Portal' });
    expect(within(link).queryAllByRole('button')).toHaveLength(0);
    expect(link.closest('button')).toBeNull();
  });
});
