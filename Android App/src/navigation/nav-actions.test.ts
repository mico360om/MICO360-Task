import { describe, it, expect } from 'vitest';
import { ALL_PROJECTS_BOARD, chatScreenId, meetingScreenId, targetToAction, taskScreenId } from './nav-actions';
import { DRAWER_SECTIONS, activeDrawerKey, actionRouteName, drawerSectionsFor } from './drawer-menu';
import { TAB_ITEMS } from './tabs';
import { isIconName } from '../lib/icons';
import { appSource as src } from '../testing/web-source';
import { notificationToTarget } from '../lib/deep-link';

describe('targetToAction', () => {
  it('pushes the task’s screen, switches to the Chat tab and opens Notifications (a stack screen now)', () => {
    expect(targetToAction({ screen: 'TaskDetail', params: { taskId: 't1' } })).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1' } });
    expect(targetToAction({ screen: 'Chat' })).toEqual({ type: 'tab', tab: 'Chat' });
    expect(targetToAction({ screen: 'Notifications' })).toEqual({ type: 'stack', screen: 'Notifications' });
  });

  it('pushes the project’s dashboard (5c)', () => {
    expect(targetToAction({ screen: 'ProjectDetail', params: { projectId: 'p1' } })).toEqual({ type: 'stack', screen: 'ProjectDetail', params: { projectId: 'p1' } });
    expect(targetToAction(notificationToTarget({ entityType: 'project', entityId: 'p2' }))).toEqual({ type: 'stack', screen: 'ProjectDetail', params: { projectId: 'p2' } });
  });

  it('pushes the meeting and My Action Items, and switches to the Meetings tab', () => {
    expect(targetToAction({ screen: 'MeetingDetail', params: { meetingId: 'm1' } })).toEqual({ type: 'stack', screen: 'MeetingDetail', params: { meetingId: 'm1' } });
    expect(targetToAction({ screen: 'MyActionItems' })).toEqual({ type: 'stack', screen: 'MyActionItems' });
    expect(targetToAction({ screen: 'Meetings' })).toEqual({ type: 'tab', tab: 'Meetings' });
    expect(targetToAction(notificationToTarget({ entityType: 'meeting', entityId: 'm2' }))).toEqual({ type: 'stack', screen: 'MeetingDetail', params: { meetingId: 'm2' } });
  });

  it('opens a conversation’s thread (a chat push, 3a), one screen per conversation', () => {
    expect(targetToAction({ screen: 'ChatThread', params: { conversationId: 'c1' } })).toEqual({ type: 'stack', screen: 'ChatThread', params: { conversationId: 'c1' } });
    const route = { params: { conversationId: 'c1', title: 'Tower A' } };
    expect(chatScreenId(route)).toBe('c1');
  });

  it('gives each task and each meeting its own screen, so a link from one to another adds a screen (Back returns)', () => {
    expect(taskScreenId({ params: { taskId: 't1' } })).toBe('t1');
    const route = { params: { meetingId: 'm1', title: 'Weekly' } };
    expect(meetingScreenId(route)).toBe('m1');
    expect(taskScreenId({ params: undefined })).toBeUndefined();
  });

  it('composes with the push resolver end to end', () => {
    // a real backend push (lowercase entityType) → opens the task
    expect(targetToAction(notificationToTarget({ entityType: 'task', entityId: 't9' }))).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't9' } });
    expect(targetToAction(notificationToTarget({ entityType: 'conversation', entityId: 'c1' }))).toEqual({ type: 'stack', screen: 'ChatThread', params: { conversationId: 'c1' } });
  });
});

const items = (sections: ReturnType<typeof drawerSectionsFor>) => sections.flatMap((s) => s.items);
const allItems = DRAWER_SECTIONS.flatMap((s) => s.items);

describe('five tabs and a menu grouped like the website’s sidebar', () => {
  it('five tabs: Dashboard, My Tasks, Projects, Meetings, Chat, with drawn icons', () => {
    expect(TAB_ITEMS.map((t) => [t.name, t.title])).toEqual([['Dashboard', 'Dashboard'], ['MyTasks', 'My Tasks'], ['Projects', 'Projects'], ['Meetings', 'Meetings'], ['Chat', 'Chat']]);
    for (const t of TAB_ITEMS) expect(isIconName(t.icon), t.name).toBe(true);
  });

  it('the drawer is grouped like the website’s sidebar', () => {
    const all = drawerSectionsFor(['ADMIN'], true);
    expect(all.map((s) => s.title)).toEqual(['Workspace', 'Communication', 'Admin', null]);
    expect(all[0]!.items.map((i) => i.label)).toEqual(['Dashboard', 'My Tasks', 'Kanban Board', 'Projects', 'Calendar', 'Timeline', 'Workload', 'Meetings', 'My Action Items', 'Templates', 'Management', 'Reports']);
    expect(all[1]!.items.map((i) => i.label)).toEqual(['Chat', 'MICO AI', 'Notifications', 'Activity']);
    expect(all[2]!.items.map((i) => i.label)).toEqual(['User Management', 'AI Management', 'System Settings', 'Audit Logs']);
    expect(all[3]!.items.map((i) => i.label)).toEqual(['Settings', 'Profile', 'About']);
    for (const i of all.flatMap((s) => s.items)) {
      expect(isIconName(i.icon), i.key).toBe(true);
      expect(i.label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('each row opens what the website’s row opens: a tab, an app screen, or the website page', () => {
    const action = (key: string) => allItems.find((i) => i.key === key)?.action;
    expect(action('Dashboard')).toEqual({ type: 'tab', tab: 'Dashboard' });
    expect(action('AllBoard')).toEqual(ALL_PROJECTS_BOARD);
    expect(action('Calendar')).toEqual({ type: 'stack', screen: 'Calendar' });
    expect(action('Notifications')).toEqual({ type: 'stack', screen: 'Notifications' });
    expect(action('Profile')).toEqual({ type: 'stack', screen: 'Profile' });
    for (const [key, path] of [['Timeline', '/timeline'], ['Workload', '/workload'], ['Templates', '/templates'], ['Management', '/management'], ['MicoAi', '/mico-ai'], ['website-ai', '/admin/ai'], ['website-settings', '/admin/settings'], ['website-audit', '/admin/audit']] as const) {
      expect(action(key), key).toEqual({ type: 'website', path });
    }
    expect(action('Users')).toEqual({ type: 'stack', screen: 'Users' });
    expect(allItems.map((i) => i.key)).not.toContain('Search'); // Search is in the top bar on every tab
  });

  it('an employee sees no Admin section, Reports or Management; someone who runs a project sees Management (Review Focus 5)', () => {
    const keys = (r: string[], lead: boolean) => items(drawerSectionsFor(r, lead)).map((i) => i.key);
    expect(drawerSectionsFor(['EMPLOYEE'], false).map((s) => s.key)).toEqual(['workspace', 'communication', 'account']);
    expect(keys(['EMPLOYEE'], false)).not.toContain('Reports');
    expect(keys(['EMPLOYEE'], true)).not.toContain('Reports');
    expect(keys(['EMPLOYEE'], false)).not.toContain('Management');
    expect(keys(['EMPLOYEE'], true)).toContain('Management');
    expect(keys(['ADMIN'], false)).toEqual(expect.arrayContaining(['Management', 'Reports', 'Users', 'website-ai']));
    for (const k of ['Users', 'website-ai', 'website-settings', 'website-audit']) expect(keys(['EMPLOYEE'], true)).not.toContain(k);
    expect(drawerSectionsFor([], false).map((s) => s.key)).toEqual(['workspace', 'communication', 'account']);
  });

  it('every row has a unique key and a destination', () => {
    const keys = allItems.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of allItems) expect(actionRouteName(i.action), i.key).toBeTruthy();
    expect(actionRouteName({ type: 'website', path: '/admin/ai' })).toBe('/admin/ai');
  });

  it('lights the row of the screen on show', () => {
    for (const [route, key] of [['Dashboard', 'Dashboard'], ['Projects', 'Projects'], ['AllBoard', 'AllBoard'], ['Calendar', 'Calendar'], ['MyActionItems', 'MyActionItems'], ['Reports', 'Reports'], ['Notifications', 'Notifications'], ['Activity', 'Activity'], ['Users', 'Users'], ['Settings', 'Settings'], ['About', 'About']] as const) {
      expect(activeDrawerKey(route), route).toBe(key);
    }
    expect(activeDrawerKey('SomethingElse')).toBeUndefined();
    expect(activeDrawerKey(undefined)).toBeUndefined();
  });

  it('the drawer reads the roles of the session on screen, every render', () =>
    expect(src('components/AppDrawer.tsx')).toMatch(/const roles = useSession\(\)\?\.user\.roles \?\? \[\];[^]*drawerSectionsFor\(roles, /));

  it('a push or link for Notifications opens its stack screen', () => expect(targetToAction({ screen: 'Notifications' })).toEqual({ type: 'stack', screen: 'Notifications' }));
});
