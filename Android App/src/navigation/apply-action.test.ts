import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { notificationToTarget } from '../lib/deep-link';
import { targetToAction } from './nav-actions';

// The root navigator, as far as opening a screen goes (React Navigation's container is native).
const nav = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('./ref', () => ({
  navigationRef: {
    isReady: () => true,
    navigate: (...a: unknown[]) => void nav.calls.push(['navigate', ...a]),
    dispatch: (...a: unknown[]) => void nav.calls.push(['dispatch', ...a]),
    resetRoot: (...a: unknown[]) => void nav.calls.push(['resetRoot', ...a]),
  },
}));
vi.mock('@react-navigation/native', async () => ({ getActionFromState: (await import('@react-navigation/core')).getActionFromState }));

const { applyNavAction } = await import('./apply-action');
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('an alert opens what it is about the way its push does — one mapping for both (final review B5)', () => {
  beforeEach(() => {
    nav.calls.length = 0;
  });
  const open = (entityType: string, entityId?: string) => {
    nav.calls.length = 0;
    applyNavAction(targetToAction(notificationToTarget({ entityType, entityId })));
    return nav.calls;
  };

  it('the task, the project’s dashboard, the meeting, the conversation — or the Chat tab, or the Alerts tab for nothing it can open', () => {
    expect(open('task', 't1')).toEqual([['navigate', 'TaskDetail', { taskId: 't1' }]]);
    expect(open('project', 'p1')).toEqual([['navigate', 'ProjectDetail', { projectId: 'p1' }]]);
    expect(open('meeting', 'm1')).toEqual([['navigate', 'MeetingDetail', { meetingId: 'm1' }]]);
    expect(open('conversation', 'c1')).toEqual([['navigate', 'ChatThread', { conversationId: 'c1' }]]);
    expect(open('conversation')).toEqual([['navigate', 'Tabs', { screen: 'Chat' }]]);
    expect(open('digest', 'x')).toEqual([['navigate', 'Tabs', { screen: 'Notifications' }]]);
    expect(open('task', '../x')).toEqual([['navigate', 'Tabs', { screen: 'Notifications' }]]);
  });

  it('the Alerts list and a tapped push both open through it', () => {
    const alerts = src('screens/NotificationsScreen.tsx');
    expect(alerts).toMatch(/applyNavAction\(targetToAction\(notificationToTarget\(\{ entityType: n\.entityType, entityId: n\.entityId \}\)\)\);/);
    expect(alerts).not.toMatch(/alertRoute|navigation\.navigate\('(TaskDetail|Board|ProjectDetail|MeetingDetail|ChatThread|Tabs)'/);
    const root = src('navigation/RootNavigator.tsx');
    expect(root).toMatch(/import \{ applyNavAction \} from '\.\/apply-action';/);
    expect(root).not.toMatch(/function applyAction\(/);
    expect(root).toMatch(/dispatch\(targetToAction\(notificationToTarget\(data\)\)\);/);
  });

  it('no alert opens a project’s board any more (5c: its dashboard): the Board target is gone', () => {
    expect(src('lib/deep-link.ts')).not.toMatch(/screen: 'Board'/);
    expect(src('navigation/nav-actions.ts')).not.toMatch(/screen: 'Board'|alertRoute|AlertRoute/);
  });
});
