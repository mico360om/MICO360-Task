import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { chatBadgeText, chatNavLabel } from '../lib/chat-badge';
import { RUNNING_BUILD } from '../lib/release';
import { BrandLogo } from './ui/BrandLogo';
import { Logo } from './ui/Logo';
import { useMediaQuery } from '../lib/useMediaQuery';

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  /** Only shown to admins (the page's API is admin-only). */
  adminOnly?: boolean;
  /** Only shown to admins and the people who run a project (the Management page). */
  leadsOnly?: boolean;
}

// Compact 24x24 stroke icons (no external dependency). Every item has its own: on the tablet rail
// the icon is all there is to tell them apart (My Action Items and AI Management used to borrow
// My Tasks' tick box and MICO AI's sparkle; Meetings and Templates looked like Calendar and Board).
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
  timeline: (
    <>
      <path d="M3 4v16" />
      <rect x="6" y="5" width="9" height="3.5" rx="1.2" />
      <rect x="9" y="10.25" width="11" height="3.5" rx="1.2" />
      <rect x="6" y="15.5" width="6" height="3.5" rx="1.2" />
    </>
  ),
  workload: (
    <>
      <circle cx="8" cy="7" r="2.6" />
      <path d="M3.5 16a4.5 4.5 0 0 1 9 0" />
      <path d="M15 20v-4M18 20v-7M21 20v-10" />
    </>
  ),
  reports: (
    <>
      <path d="M3 21h18" />
      <path d="M6 21v-6M11 21V8M16 21v-9" />
    </>
  ),
  management: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12l4.5-4.5" />
      <path d="M12 3.5V6M20.5 12H18M3.5 12H6" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 7.5-2.5 7.5h17S18 15 18 8.5" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </>
  ),
  activity: <path d="M3 12h4l2.5 7 5-14 2.5 7H21" />,
  // Two people at a table.
  meetings: (
    <>
      <circle cx="8" cy="6.5" r="2.4" />
      <circle cx="16" cy="6.5" r="2.4" />
      <path d="M4 13.5a4 4 0 0 1 8 0M12 13.5a4 4 0 0 1 8 0" />
      <path d="M2.5 15.5h19M5 15.5V21M19 15.5V21" />
    </>
  ),
  // A checklist.
  actionItems: (
    <>
      <path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17" />
      <path d="M11 6.5h9.5M11 12.5h9.5M11 18.5h9.5" />
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
  // A copy of a page, from the one behind it.
  templates: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
      <path d="M11.5 12.5h6M11.5 16.5h3.5" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l1.6 4.2L18 8.8l-4.4 1.6L12 15l-1.6-4.6L6 8.8l4.4-1.6z" />
      <path d="M18 14l.7 1.9L21 16.6l-2.3.7L18 20l-.7-2.3-2.3-.8 2.3-.9z" />
    </>
  ),
  // A chip with a spark: the AI service's settings.
  aiManagement: (
    <>
      <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" />
      <path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" />
      <path d="M12 8.6l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z" />
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
  { label: 'Timeline', to: '/timeline', icon: I.timeline },
  { label: 'Workload', to: '/workload', icon: I.workload },
  { label: 'Meetings', to: '/meetings', icon: I.meetings },
  { label: 'My Action Items', to: '/my-action-items', icon: I.actionItems },
  { label: 'Templates', to: '/templates', icon: I.templates },
  { label: 'Management', to: '/management', icon: I.management, leadsOnly: true },
  { label: 'Reports', to: '/reports', icon: I.reports, adminOnly: true },
];
const COMMUNICATION: NavItem[] = [
  { label: 'Chat', to: '/chat', icon: I.chat },
  { label: 'MICO AI', to: '/mico-ai', icon: I.ai },
  { label: 'Notifications', to: '/notifications', icon: I.notifications },
  { label: 'Activity', to: '/activity', icon: I.activity },
];
const ADMIN: NavItem[] = [
  { label: 'User Management', to: '/admin/users', icon: I.users },
  { label: 'AI Management', to: '/admin/ai', icon: I.aiManagement },
  { label: 'System Settings', to: '/admin/settings', icon: I.sliders },
  { label: 'Audit Logs', to: '/admin/audit', icon: I.audit },
];

export interface SidebarProps {
  isAdmin: boolean;
  /** Runs a project (or is an admin): the Management page is theirs to see. */
  canLead?: boolean;
  /** Unread chat messages, shown on the Chat icon (none at 0). */
  chatUnread?: number;
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
// `rail`: on a tablet (768–1023px) the menu is a 64px rail — the icon centred, its words kept for
// screen readers (sr-only) and shown beside it as a tooltip (RailTooltip).
const linkClass =
  (rail: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    [
      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 [@media(pointer:coarse)]:min-h-11',
      rail ? 'md:max-lg:justify-center md:max-lg:gap-0 md:max-lg:px-0' : '',
      isActive ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:bg-ground hover:text-ink',
    ].join(' ');

/** A link's words: beside the icon, or (on the rail) for screen readers only. */
const labelClass = (rail: boolean) => (rail ? 'truncate md:max-lg:sr-only' : 'truncate');

function SectionLabel({ children, rail }: { children: ReactNode; rail: boolean }) {
  return <div className={`px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 ${rail ? 'md:max-lg:sr-only' : ''}`}>{children}</div>;
}

/**
 * The unread count on the Chat icon: a small pill over its top corner, in the notification bell's
 * style — brand red on a plain row, white on the highlighted one, so it reads on both. The number is
 * said through the link's name.
 */
function ChatBadge({ count, active }: { count: number; active: boolean }) {
  const text = chatBadgeText(count);
  if (!text) return null;
  return (
    <span
      data-chat-badge
      aria-hidden="true"
      className={`pointer-events-none absolute -end-2 -top-2 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums ring-2 ${
        active ? 'bg-white text-brand-ink ring-brand' : 'bg-brand text-white ring-surface'
      }`}
    >
      {text}
    </span>
  );
}

function NavGroup({ label, items, onNavigate, chatUnread = 0, rail, first = false }: { label: string; items: NavItem[]; onNavigate?: () => void; chatUnread?: number; rail: boolean; first?: boolean }) {
  return (
    <>
      {/* On the rail the group names give way to a thin line between the groups. */}
      {rail && !first ? <div data-rail-divider aria-hidden="true" className="mx-1.5 my-2 hidden border-t border-line md:max-lg:block" /> : null}
      <SectionLabel rail={rail}>{label}</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {items.map((item) =>
          item.to === '/chat' ? (
            <NavLink key={item.to} to={item.to} className={linkClass(rail)} onClick={onNavigate} aria-label={chatNavLabel(chatUnread)} data-rail-label={item.label}>
              {({ isActive }) => (
                <>
                  <span className="relative flex shrink-0">
                    <NavIcon>{item.icon}</NavIcon>
                    <ChatBadge count={chatUnread} active={isActive} />
                  </span>
                  <span className={labelClass(rail)}>{item.label}</span>
                </>
              )}
            </NavLink>
          ) : (
            <NavLink key={item.to} to={item.to} className={linkClass(rail)} onClick={onNavigate} data-rail-label={item.label}>
              <NavIcon>{item.icon}</NavIcon>
              <span className={labelClass(rail)}>{item.label}</span>
            </NavLink>
          ),
        )}
      </div>
    </>
  );
}

/** The window width at which the menu is the slim rail (the `md:max-lg:` classes). */
const RAIL_WIDTHS = '(min-width: 48em) and (max-width: 63.99em)';

/**
 * The name of the rail link under the pointer or the keyboard focus, beside its icon. One floating
 * label for the whole rail, in <body> (the rail's list scrolls, which would cut off a label inside
 * it). It repeats the link's own name, so it is hidden from screen readers. Escape puts it away;
 * the pointer can move onto it without losing it.
 */
function RailTooltip({ root }: { root: RefObject<HTMLElement> }) {
  const onRail = useMediaQuery(RAIL_WIDTHS);
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nav = root.current;
    setTip(null);
    if (!nav || !onRail) return;
    const linkOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-rail-label]') : null);
    const onTip = (target: EventTarget | null) => target instanceof Node && Boolean(tipRef.current?.contains(target));
    const show = (link: HTMLElement | null) => {
      if (!link || !nav.contains(link)) return;
      const box = link.getBoundingClientRect();
      setTip({ label: link.dataset.railLabel ?? '', top: box.top + box.height / 2, left: box.right });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') show(linkOf(e.target));
    };
    const out = (e: PointerEvent) => {
      if (!linkOf(e.relatedTarget) && !onTip(e.relatedTarget)) setTip(null);
    };
    const focus = (e: FocusEvent) => show(linkOf(e.target));
    const blur = (e: FocusEvent) => {
      if (!linkOf(e.relatedTarget)) setTip(null);
    };
    const hide = () => setTip(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(null);
    };
    nav.addEventListener('pointerover', over);
    nav.addEventListener('pointerout', out);
    nav.addEventListener('focusin', focus);
    nav.addEventListener('focusout', blur);
    nav.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', key);
    return () => {
      nav.removeEventListener('pointerover', over);
      nav.removeEventListener('pointerout', out);
      nav.removeEventListener('focusin', focus);
      nav.removeEventListener('focusout', blur);
      nav.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('keydown', key);
    };
  }, [root, onRail]);
  if (!tip) return null;
  return createPortal(
    <div
      ref={tipRef}
      data-rail-tooltip
      aria-hidden="true"
      onPointerLeave={(e) => {
        if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-rail-label]'))) setTip(null);
      }}
      className="fixed z-[60] flex -translate-y-1/2 items-center ps-3"
      style={{ top: tip.top, left: tip.left }}
    >
      <span className="whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface shadow-lift">{tip.label}</span>
    </div>,
    document.body,
  );
}

/**
 * The menu beside the page: from 1024px the full 240px menu; on a tablet (768–1023px) a 64px rail
 * of icons, each with its name for screen readers and as a tooltip; on a phone it folds away behind
 * the ☰ button (MobileMenu in AppShell).
 */
export function Sidebar({ isAdmin, chatUnread = 0, canLead = false }: SidebarProps) {
  const nav = useRef<HTMLElement>(null);
  return (
    <nav
      ref={nav}
      aria-label="Main"
      className="sticky top-0 hidden h-screen w-16 flex-none flex-col border-r border-line bg-surface/95 md:flex lg:w-60 supports-[height:100dvh]:h-dvh"
    >
      <SidebarBody isAdmin={isAdmin} chatUnread={chatUnread} canLead={canLead} rail />
      <RailTooltip root={nav} />
    </nav>
  );
}

/**
 * The sidebar's inner content — reused by the desktop menu and the phone's menu. `rail`: may become
 * the tablet rail (the desktop menu only; the phone's menu never does).
 */
export function SidebarBody({ isAdmin, onNavigate, chatUnread = 0, canLead = false, rail = false }: SidebarProps & { onNavigate?: () => void; rail?: boolean }) {
  const { pathname } = useLocation();
  const list = useRef<HTMLDivElement>(null);
  // On a short window the list scrolls: never leave the link of the current page below the fold.
  // The list is scrolled directly — scrollIntoView() also moves the point Tab starts from in
  // Chrome, which made the first Tab skip "Skip to content".
  useEffect(() => {
    const box = list.current;
    const link = box?.querySelector('[aria-current="page"]');
    if (!box || !link) return;
    const view = box.getBoundingClientRect();
    const at = link.getBoundingClientRect();
    const margin = 8;
    if (at.bottom > view.bottom) box.scrollTop += at.bottom - view.bottom + margin;
    else if (at.top < view.top) box.scrollTop -= view.top - at.top + margin;
    // Again when links come or go above it (Management appears once access is known).
  }, [pathname, isAdmin, canLead]);

  return (
    <>
      {/* As tall as the top bar (h-14), so their bottom lines meet as one. The logo: one per theme,
          lazy — the hidden one is never downloaded. */}
      <div className={`flex h-14 flex-none items-center border-b border-line px-5 ${rail ? 'md:max-lg:justify-center md:max-lg:px-0' : ''}`}>
        <span data-rail-wordmark className={`flex ${rail ? 'md:max-lg:hidden' : ''}`}>
          <BrandLogo lazy className="h-9" />
        </span>
        {/* The rail is too narrow for the wordmark: the app's tile mark instead. */}
        {rail ? (
          <span data-rail-mark className="hidden md:max-lg:block">
            <Logo size={34} title="MICO360 Tasks" />
          </span>
        ) : null}
      </div>

      {/* The rail hides its scrollbar (it would take a sixth of 64px); the edge shadows still say
          there is more, and the current page's link is scrolled into view (above). */}
      <div ref={list} className={`scroll-shadows flex-1 overflow-y-auto px-3 py-3 ${rail ? 'md:max-lg:px-2.5 md:max-lg:[scrollbar-width:none] md:max-lg:[&::-webkit-scrollbar]:hidden' : ''}`}>
        <NavGroup label="Workspace" items={WORKSPACE.filter((i) => (isAdmin || !i.adminOnly) && (isAdmin || canLead || !i.leadsOnly))} onNavigate={onNavigate} rail={rail} first />
        <NavGroup label="Communication" items={COMMUNICATION} onNavigate={onNavigate} chatUnread={chatUnread} rail={rail} />
        {isAdmin ? <NavGroup label="Admin" items={ADMIN} onNavigate={onNavigate} rail={rail} /> : null}
      </div>

      <div className={`border-t border-line px-3 py-2 ${rail ? 'md:max-lg:px-2.5' : ''}`}>
        <NavLink to="/settings" className={linkClass(rail)} onClick={onNavigate} data-rail-label="Settings">
          <NavIcon>{I.settings}</NavIcon>
          <span className={labelClass(rail)}>Settings</span>
        </NavLink>
        <div className={`px-3 pt-2 text-[11px] text-ink-3 ${rail ? 'md:max-lg:px-0 md:max-lg:text-center' : ''}`}>
          <span data-rail-version-brand className={rail ? 'md:max-lg:hidden' : ''}>
            <span className="gradient-text font-semibold">MICO360</span> ·{' '}
          </span>
          v{RUNNING_BUILD.version}
        </div>
      </div>
    </>
  );
}
