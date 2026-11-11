import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { QueryClientContext } from '@tanstack/react-query';
import { everythingFilters, isSavedSearch, savedAddress } from '../lib/search-everything';
import { countLabel, useSavedCounts, useSavedSearches } from '../lib/useSavedSearches';
import { chatBadgeText, chatNavLabel } from '../lib/chat-badge';
import { RUNNING_BUILD } from '../lib/release';
import { BrandLogo } from './ui/BrandLogo';
import { Logo } from './ui/Logo';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useSetAppearance, useSidebarCollapsed } from '../lib/appearance';
import { MenuDrawer } from './MenuDrawer';

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
  // A visitor's pass: the client accounts (people outside the company).
  clients: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16.5a3.4 3.4 0 0 1 6.4 0M14.5 10h4M14.5 13.5h3" />
    </>
  ),
  // Two buildings: the companies on the site.
  companies: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16" />
      <path d="M14 10h4a1 1 0 0 1 1 1v10" />
      <path d="M8 8h2M8 12h2M8 16h2" />
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

/**
 * Project KPIs and User KPIs: a gauge — My performance. Kept out of `I`, the icon set the Android app copies
 * (its menu has no such page).
 */
const PERFORMANCE_ICON = (
  <>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="M12 17l4-5" />
    <path d="M7 17h.01M17 17h.01M12 9.5V9" />
  </>
);

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
  { label: 'My performance', to: '/performance', icon: PERFORMANCE_ICON },
  { label: 'Management', to: '/management', icon: I.management, leadsOnly: true },
  { label: 'Reports', to: '/reports', icon: I.reports, adminOnly: true },
];
const COMMUNICATION: NavItem[] = [
  { label: 'Chat', to: '/chat', icon: I.chat },
  { label: 'MICO AI', to: '/mico-ai', icon: I.ai },
  { label: 'Notifications', to: '/notifications', icon: I.notifications },
  { label: 'Activity', to: '/activity', icon: I.activity },
];
/**
 * 1.22.4: a warning triangle — the Error log, a website-only admin page. Kept out of `I`, the icon set
 * the Android app copies (its menu has no such page).
 */
const ERROR_LOG_ICON = (
  <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>
);

const ADMIN: NavItem[] = [
  { label: 'User Management', to: '/admin/users', icon: I.users },
  { label: 'Clients', to: '/admin/clients', icon: I.clients },
  { label: 'Companies', to: '/admin/companies', icon: I.companies },
  { label: 'AI Management', to: '/admin/ai', icon: I.aiManagement },
  { label: 'System Settings', to: '/admin/settings', icon: I.sliders },
  { label: 'Error Log', to: '/admin/error-log', icon: ERROR_LOG_ICON },
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
// `rail`: on a tablet (768–1023px), and on a desktop when the person folded it (1.23.8), the menu is a
// 64px rail — the icon centred, its words kept for screen readers (sr-only) and shown beside it as a
// tooltip (RailTooltip). The `rail:` variant (tailwind.config.js) is both cases.
const linkClass =
  (rail: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    [
      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 [@media(pointer:coarse)]:min-h-11',
      rail ? 'rail:justify-center rail:gap-0 rail:px-0' : '',
      isActive ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:bg-ground hover:text-ink',
    ].join(' ');

/** A link's words: beside the icon, or (on the rail) for screen readers only. */
const labelClass = (rail: boolean) => (rail ? 'truncate rail:sr-only' : 'truncate');

function SectionLabel({ children, rail }: { children: ReactNode; rail: boolean }) {
  return <div className={`px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 ${rail ? 'rail:sr-only' : ''}`}>{children}</div>;
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

/** 1.23.8 The Admin group's icon on the rail (kept out of `I`, the icon set the Android app copies). */
const ADMIN_GROUP_ICON = (
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7M3 12.5h18M10.5 12.5v2h3v-2" />
  </>
);
const SAVED_ICON = <path d="M6.5 4h11v16l-5.5-3.8L6.5 20z" />;

interface FlyoutItem {
  key: string;
  to: string;
  label: string;
  /** Said in full (a saved search's count). */
  name?: string;
  /** Marked as the page you are on (a saved search; plain links say it themselves). */
  current?: boolean;
  icon: ReactNode;
}

/**
 * 1.23.8 A group on the rail (the menu folded, or a tablet): one icon that opens a small list beside it — by hover,
 * a click, or Enter / Space / Down arrow — so every item stays one step away while the rail stays short (owner, 10
 * Nov: the Admin items; the pinned searches, which share one icon). The arrow keys move through it, Home and End
 * go to its ends, Escape (or Tab, or a click elsewhere) closes it and gives focus back to the icon; choosing an
 * item goes there and closes it. Drawn in <body> (the rail's list scrolls and would cut it off).
 */
function FlyoutGroup({ label, icon, items, onNavigate }: { label: string; icon: ReactNode; items: FlyoutItem[]; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  /** Opened by the pointer resting on the icon (a click then keeps it open and moves into it). */
  const byHover = useRef(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const current = items.some((i) => i.current || pathname === i.to || pathname.startsWith(`${i.to}/`));

  /** Beside the icon, inside the window. */
  const measure = () => {
    const r = button.current?.getBoundingClientRect();
    const height = 48 + items.length * 40;
    const top = Math.max(8, Math.min(r?.top ?? 0, window.innerHeight - height - 8));
    setPlace({ top, left: (r?.right ?? 64) + 6 });
  };
  const show = (withFocus: boolean) => {
    if (leave.current) clearTimeout(leave.current);
    byHover.current = !withFocus;
    // Already drawn (read from the page, not from this render: a click right after the hover that opened it).
    if (menu.current) {
      if (withFocus) menu.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      return;
    }
    measure();
    focusFirst.current = withFocus;
    setOpen(true);
  };
  const hide = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  // Hover: closes a moment after the pointer leaves both the icon and the list (time to cross the gap).
  const pointerLeft = () => {
    if (leave.current) clearTimeout(leave.current);
    leave.current = setTimeout(() => {
      if (!menu.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    // The menu (or the page) scrolled: the list follows its icon, and goes once the icon is out of sight.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      const r = button.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight || r.width === 0) setOpen(false);
      else measure();
    };
    // Escape closes it wherever the focus is (a list opened by hover has none of it).
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = !!menu.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) button.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onEscape);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onEscape);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);
  useEffect(() => () => {
    if (leave.current) clearTimeout(leave.current);
  }, []);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // Back on the icon first (the list is at the end of the page): Tab then moves on from there.
      button.current?.focus();
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        data-rail-label={label}
        data-flyout
        data-current={current ? 'true' : undefined}
        onClick={() => (open && !byHover.current ? hide(false) : show(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            show(true);
          }
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'touch') show(false);
        }}
        onPointerLeave={pointerLeft}
        className={`${linkClass(true)({ isActive: current })} w-full`}
      >
        <NavIcon>{icon}</NavIcon>
        <span className={labelClass(true)}>{label}</span>
      </button>
      {open && place
        ? createPortal(
            <div
              ref={menu}
              id={id}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKey}
              onPointerEnter={() => leave.current && clearTimeout(leave.current)}
              onPointerLeave={pointerLeft}
              style={{ top: place.top, left: place.left }}
              className="fixed z-[60] w-60 max-w-[calc(100vw-5rem)] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lift animate-scale-in"
            >
              <p aria-hidden="true" className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {label}
              </p>
              {items.map((item) => {
                const look = (on: boolean) =>
                  `flex items-center gap-2.5 px-3 py-2 text-sm outline-none transition-colors [@media(pointer:coarse)]:min-h-11 ${on ? 'bg-brand/10 font-semibold text-brand' : 'text-ink hover:bg-ground focus-visible:bg-ground'}`;
                const pick = () => {
                  setOpen(false);
                  onNavigate?.();
                };
                const inner = (
                  <>
                    <NavIcon>{item.icon}</NavIcon>
                    <span dir="auto" className="min-w-0 truncate">{item.label}</span>
                  </>
                );
                // A saved search says itself whether it is the one shown (the Search page's address has a query
                // NavLink can't see); a page link lets NavLink mark it.
                return item.current !== undefined ? (
                  <Link key={item.key} to={item.to} role="menuitem" aria-label={item.name} aria-current={item.current ? 'page' : undefined} onClick={pick} className={look(item.current)}>
                    {inner}
                  </Link>
                ) : (
                  <NavLink key={item.key} to={item.to} role="menuitem" aria-label={item.name} onClick={pick} className={({ isActive }) => look(isActive)}>
                    {inner}
                  </NavLink>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function NavGroup({ label, items, onNavigate, chatUnread = 0, rail, first = false, flyout }: { label: string; items: NavItem[]; onNavigate?: () => void; chatUnread?: number; rail: boolean; first?: boolean; /** 1.23.8: on the rail, one icon with a fly-out list (the Admin group). */ flyout?: ReactNode }) {
  const onRail = useOnRail();
  if (rail && flyout && onRail) {
    return (
      <>
        <div data-rail-divider aria-hidden="true" className="mx-1.5 my-2 hidden border-t border-line rail:block" />
        <SectionLabel rail={rail}>{label}</SectionLabel>
        <FlyoutGroup label={label} icon={flyout} items={items.map((i) => ({ key: i.to, to: i.to, label: i.label, icon: i.icon }))} onNavigate={onNavigate} />
      </>
    );
  }
  return (
    <>
      {/* On the rail the group names give way to a thin line between the groups. */}
      {rail && !first ? <div data-rail-divider aria-hidden="true" className="mx-1.5 my-2 hidden border-t border-line rail:block" /> : null}
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

/**
 * 1.23.6 "Saved": the searches the person pinned (up to 5, their own or shared with them), each with how
 * many items it finds now — asked for again every minute. The one shown on the Search page is marked.
 */
function SavedNav({ onNavigate, rail }: { onNavigate?: () => void; rail: boolean }) {
  const { pinned } = useSavedSearches();
  const counts = useSavedCounts(pinned.map((s) => s.id));
  const { pathname, search } = useLocation();
  const onRail = useOnRail();
  if (pinned.length === 0) return null;
  const here = pathname === '/search' ? everythingFilters(new URLSearchParams(search)) : null;
  // 1.23.8: on the rail the pinned searches (one icon for all) are one Saved icon with a fly-out list.
  if (rail && onRail) {
    return (
      <>
        <div data-rail-divider aria-hidden="true" className="mx-1.5 my-2 hidden border-t border-line rail:block" />
        <SectionLabel rail={rail}>Saved</SectionLabel>
        <FlyoutGroup
          label="Saved"
          icon={SAVED_ICON}
          onNavigate={onNavigate}
          items={pinned.map((s) => {
            const count = countLabel(counts.data?.[s.id]);
            return {
              key: s.id,
              to: `/search?${savedAddress(s)}`,
              label: count ? `${s.name} · ${count}` : s.name,
              name: count ? `${s.name}, ${count} ${count === '1' ? 'result' : 'results'}` : s.name,
              current: here ? isSavedSearch(here, s) : false,
              icon: SAVED_ICON,
            };
          })}
        />
      </>
    );
  }
  return (
    <>
      {rail ? <div data-rail-divider aria-hidden="true" className="mx-1.5 my-2 hidden border-t border-line rail:block" /> : null}
      <SectionLabel rail={rail}>Saved</SectionLabel>
      <div className="flex flex-col gap-0.5" data-saved-nav>
        {pinned.map((s) => {
          const active = here ? isSavedSearch(here, s) : false;
          const count = countLabel(counts.data?.[s.id]);
          return (
            <Link
              key={s.id}
              to={`/search?${savedAddress(s)}`}
              className={linkClass(rail)({ isActive: active })}
              aria-current={active ? 'page' : undefined}
              aria-label={count ? `${s.name}, ${count} ${count === '1' ? 'result' : 'results'}` : s.name}
              onClick={onNavigate}
              data-rail-label={s.name}
            >
              <NavIcon>
                <path d="M6.5 4h11v16l-5.5-3.8L6.5 20z" />
              </NavIcon>
              <span dir="auto" className={`${labelClass(rail)} min-w-0 flex-1`}>
                {s.name}
              </span>
              {count ? (
                <span aria-hidden="true" className={`flex-none rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${active ? 'bg-black/20 text-white' : 'bg-ground text-ink-2'} ${rail ? 'rail:hidden' : ''}`}>
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </>
  );
}

/** The window width at which the menu is always the slim rail (a tablet), and from which it can be folded. */
const RAIL_WIDTHS = '(min-width: 48em) and (max-width: 63.99em)';
const DESKTOP = '(min-width: 64em)';

/** True while the menu beside the page is the icon rail: a tablet, or a desktop with the menu folded. */
function useOnRail(): boolean {
  const tablet = useMediaQuery(RAIL_WIDTHS);
  const desktop = useMediaQuery(DESKTOP);
  const folded = useSidebarCollapsed();
  return tablet || (desktop && folded);
}

/**
 * The name of the rail link under the pointer or the keyboard focus, beside its icon. One floating
 * label for the whole rail, in <body> (the rail's list scrolls, which would cut off a label inside
 * it). It repeats the link's own name, so it is hidden from screen readers. Escape puts it away;
 * the pointer can move onto it without losing it.
 */
function RailTooltip({ root }: { root: RefObject<HTMLElement> }) {
  const onRail = useOnRail();
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
      const link = linkOf(e.target);
      // A group's icon opens its fly-out list on hover instead (it says the group's name).
      if (e.pointerType !== 'touch' && !link?.hasAttribute('data-flyout')) show(link);
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
 * 1.23.8 "Collapse the menu" («) / "Expand the menu" (») at the foot of the desktop menu: folds it to the
 * icon rail and back, saved on the person's account. Desktop only — a tablet always has the rail. On the
 * rail it names itself beside it like the links (data-rail-label).
 */
function FoldButton({ onTabletOpen, tabletOpen = false }: { onTabletOpen?: () => void; tabletOpen?: boolean }) {
  const folded = useSidebarCollapsed();
  const { change, failed } = useSetAppearance();
  // A tablet (owner, 10 Nov): folded by default; unfolding opens the whole menu over the page (not saved).
  const tablet = useMediaQuery(RAIL_WIDTHS);
  const label = tablet || folded ? 'Expand the menu' : 'Collapse the menu';
  const toggle = () => {
    if (tablet) return onTabletOpen?.();
    change({ sidebarCollapsed: !folded });
    // Once the menu has its new width (200 ms), the page measures again: the board, Timeline and Calendar
    // fit the room they now have.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
  };
  return (
    <>
    <button
      type="button"
      onClick={toggle}
      aria-expanded={tablet ? tabletOpen : !folded}
      aria-controls={tablet ? undefined : 'main-menu'}
      aria-haspopup={tablet ? 'dialog' : undefined}
      data-rail-label={label}
      className={`${linkClass(true)({ isActive: false })} hidden w-full md:flex`}
    >
      <NavIcon>{tablet || folded ? <path d="M6 7l5 5-5 5M13 7l5 5-5 5" /> : <path d="M18 7l-5 5 5 5M11 7l-5 5 5 5" />}</NavIcon>
      <span className={labelClass(true)}>{label}</span>
    </button>
    {/* The menu narrows back when the fold can't be saved — and says why (the menu itself is too narrow to). */}
    {failed
      ? createPortal(
          <p role="alert" className="fixed bottom-4 start-4 z-[60] max-w-xs rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-medium text-danger shadow-lift">
            Couldn’t save the menu’s fold. Please try again.
          </p>,
          document.body,
        )
      : null}
    </>
  );
}

/**
 * The menu beside the page: from 1024px the full 240px menu, which the person may fold to the icon rail
 * (1.23.8, the « button, saved on their account); on a tablet (768–1023px) always a 64px rail of icons,
 * each with its name for screen readers and as a tooltip; on a phone it folds away behind the ☰ button
 * (MobileMenu in AppShell).
 */
export function Sidebar({ isAdmin, chatUnread = 0, canLead = false }: SidebarProps) {
  const nav = useRef<HTMLElement>(null);
  // 1.23.8 A tablet's unfolded menu: over the page, until a page is chosen, a tap outside or Escape.
  const tablet = useMediaQuery(RAIL_WIDTHS);
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    if (!tablet) setOverlay(false);
  }, [tablet]);
  return (
    <>
    <nav
      ref={nav}
      id="main-menu"
      aria-label="Main"
      className="sticky top-0 hidden h-screen w-16 flex-none flex-col overflow-hidden border-r border-line bg-surface/95 transition-[width] duration-200 ease-out md:flex lg:w-60 rail:w-16 supports-[height:100dvh]:h-dvh"
    >
      <SidebarBody isAdmin={isAdmin} chatUnread={chatUnread} canLead={canLead} rail onTabletOpen={() => setOverlay(true)} tabletOpen={overlay} />
      <RailTooltip root={nav} />
    </nav>
    {overlay ? (
      <MenuDrawer className="hidden md:block lg:hidden" onClose={() => setOverlay(false)}>
        {(close) => (
          <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
            <SidebarBody isAdmin={isAdmin} chatUnread={chatUnread} canLead={canLead} onNavigate={close} onCollapse={close} />
          </nav>
        )}
      </MenuDrawer>
    ) : null}
    </>
  );
}

/**
 * The sidebar's inner content — reused by the desktop menu and the phone's menu. `rail`: may become
 * the tablet rail (the desktop menu only; the phone's menu never does).
 */
export function SidebarBody({
  isAdmin,
  onNavigate,
  chatUnread = 0,
  canLead = false,
  rail = false,
  onTabletOpen,
  tabletOpen,
  onCollapse,
}: SidebarProps & {
  onNavigate?: () => void;
  rail?: boolean;
  /** 1.23.8: a tablet's rail opens the whole menu over the page. */
  onTabletOpen?: () => void;
  tabletOpen?: boolean;
  /** 1.23.8: the menu over the page (a tablet) closes with its own "Collapse the menu". */
  onCollapse?: () => void;
}) {
  const { pathname } = useLocation();
  const list = useRef<HTMLDivElement>(null);
  // 1.23.6: the pinned saved searches need the app's data layer (absent in a bare test render).
  const withData = useContext(QueryClientContext) !== undefined;
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
      <div className={`flex h-14 flex-none items-center border-b border-line px-5 ${rail ? 'rail:justify-center rail:px-0' : ''}`}>
        <span data-rail-wordmark className={`flex ${rail ? 'rail:hidden' : ''}`}>
          <BrandLogo lazy className="h-9" />
        </span>
        {/* The rail is too narrow for the wordmark: the app's tile mark instead. */}
        {rail ? (
          <span data-rail-mark className="hidden rail:block">
            <Logo size={34} title="MICO360 Tasks" />
          </span>
        ) : null}
      </div>

      {/* The rail hides its scrollbar (it would take a sixth of 64px); the edge shadows still say
          there is more, and the current page's link is scrolled into view (above). */}
      <div ref={list} className={`scroll-shadows flex-1 overflow-y-auto px-3 py-3 ${rail ? 'rail:px-2.5 rail:[scrollbar-width:none] rail:[&::-webkit-scrollbar]:hidden' : ''}`}>
        <NavGroup label="Workspace" items={WORKSPACE.filter((i) => (isAdmin || !i.adminOnly) && (isAdmin || canLead || !i.leadsOnly))} onNavigate={onNavigate} rail={rail} first />
        {withData ? <SavedNav onNavigate={onNavigate} rail={rail} /> : null}
        <NavGroup label="Communication" items={COMMUNICATION} onNavigate={onNavigate} chatUnread={chatUnread} rail={rail} />
        {isAdmin ? <NavGroup label="Admin" items={ADMIN} onNavigate={onNavigate} rail={rail} flyout={ADMIN_GROUP_ICON} /> : null}
      </div>

      <div className={`border-t border-line px-3 py-2 ${rail ? 'rail:px-2.5' : ''}`}>
        <NavLink to="/settings" className={linkClass(rail)} onClick={onNavigate} data-rail-label="Settings">
          <NavIcon>{I.settings}</NavIcon>
          <span className={labelClass(rail)}>Settings</span>
        </NavLink>
        {rail && withData ? <FoldButton onTabletOpen={onTabletOpen} tabletOpen={tabletOpen} /> : null}
        {onCollapse ? (
          <button type="button" onClick={onCollapse} className={`${linkClass(false)({ isActive: false })} w-full`}>
            <NavIcon>
              <path d="M18 7l-5 5 5 5M11 7l-5 5 5 5" />
            </NavIcon>
            <span className={labelClass(false)}>Collapse the menu</span>
          </button>
        ) : null}
        <div className={`px-3 pt-2 text-[11px] text-ink-3 ${rail ? 'rail:px-0 rail:text-center' : ''}`}>
          <span data-rail-version-brand className={rail ? 'rail:hidden' : ''}>
            <span className="gradient-text font-semibold">MICO360</span> ·{' '}
          </span>
          v{RUNNING_BUILD.version}
        </div>
      </div>
    </>
  );
}
