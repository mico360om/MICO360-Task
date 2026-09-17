import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import logo from '../assets/logo.png';
import logoW from '../assets/logo-w.png';

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
}

// Compact 24x24 stroke icons (no external dependency).
const I = {
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  tasks: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M8 12l2.5 2.5L16 9" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18M15 3v18" />
    </>
  ),
  projects: <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  reports: (
    <>
      <path d="M3 21h18" />
      <path d="M6 21v-6M11 21V8M16 21v-9" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 7.5-2.5 7.5h17S18 15 18 8.5" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </>
  ),
  activity: <path d="M3 12h4l2.5 7 5-14 2.5 7H21" />,
  meetings: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      <path d="M8.5 14l2 2 4-4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  users: (
    <>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4 20a6 6 0 0 1 12 0" />
      <circle cx="18.5" cy="15.5" r="2.2" />
    </>
  ),
  sliders: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M20 12h-3M7 12H4M17.7 6.3l-2 2M8.3 15.7l-2 2M17.7 17.7l-2-2M8.3 8.3l-2-2" />
    </>
  ),
  audit: (
    <>
      <path d="M12 3l7 3v5c0 5-3 8-7 9.5C8 19 5 16 5 11V6z" />
      <path d="M9 11.5l2 2 4-4" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l1.6 4.2L18 8.8l-4.4 1.6L12 15l-1.6-4.6L6 8.8l4.4-1.6z" />
      <path d="M18 14l.7 1.9L21 16.6l-2.3.7L18 20l-.7-2.3-2.3-.8 2.3-.9z" />
    </>
  ),
};

// Grouped so the rail reads as a few short sections rather than one long list.
const WORKSPACE: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: I.dashboard },
  { label: 'My Tasks', to: '/my-tasks', icon: I.tasks },
  { label: 'Kanban Board', to: '/board', icon: I.board },
  { label: 'Projects', to: '/projects', icon: I.projects },
  { label: 'Calendar', to: '/calendar', icon: I.calendar },
  { label: 'Meetings', to: '/meetings', icon: I.meetings },
  { label: 'My Action Items', to: '/my-action-items', icon: I.tasks },
  { label: 'Reports', to: '/reports', icon: I.reports },
];
const COMMUNICATION: NavItem[] = [
  { label: 'Chat', to: '/chat', icon: I.chat },
  { label: 'Notifications', to: '/notifications', icon: I.notifications },
  { label: 'Activity', to: '/activity', icon: I.activity },
];
const ADMIN: NavItem[] = [
  { label: 'User Management', to: '/admin/users', icon: I.users },
  { label: 'AI Management', to: '/admin/ai', icon: I.ai },
  { label: 'System Settings', to: '/admin/settings', icon: I.sliders },
  { label: 'Audit Logs', to: '/admin/audit', icon: I.audit },
];

export interface SidebarProps {
  isAdmin: boolean;
}

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

// One crisp signal for the active route: a filled brand pill. No extra bar/shadow stack.
const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
    isActive ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:bg-ground hover:text-ink',
  ].join(' ');

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{children}</div>;
}

function NavGroup({ label, items, onNavigate }: { label: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={linkClass} onClick={onNavigate}>
            <NavIcon>{item.icon}</NavIcon>
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </>
  );
}

export function Sidebar({ isAdmin }: SidebarProps) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-screen w-60 flex-none flex-col border-r border-line bg-surface/95 md:flex"
    >
      <SidebarBody isAdmin={isAdmin} />
    </nav>
  );
}

/** The sidebar's inner content — reused by the desktop rail and the mobile drawer. */
export function SidebarBody({ isAdmin, onNavigate }: SidebarProps & { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-16 items-center border-b border-line px-5">
        <img src={logo} alt="MICO360" className="h-9 w-auto max-w-full object-contain dark:hidden" />
        <img src={logoW} alt="MICO360" className="hidden h-9 w-auto max-w-full object-contain dark:block" />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <NavGroup label="Workspace" items={WORKSPACE} onNavigate={onNavigate} />
        <NavGroup label="Communication" items={COMMUNICATION} onNavigate={onNavigate} />
        {isAdmin ? <NavGroup label="Admin" items={ADMIN} onNavigate={onNavigate} /> : null}
      </div>

      <div className="border-t border-line px-3 py-2">
        <NavLink to="/settings" className={linkClass} onClick={onNavigate}>
          <NavIcon>{I.settings}</NavIcon>
          <span className="truncate">Settings</span>
        </NavLink>
        <div className="px-3 pt-2 text-[11px] text-ink-3">
          <span className="gradient-text font-semibold">MICO360</span> · v1
        </div>
      </div>
    </>
  );
}
