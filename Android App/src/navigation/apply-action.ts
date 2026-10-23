import { getActionFromState } from '@react-navigation/native';
import { navigationRef } from './ref';
import { linkingConfig } from './linking';
import type { NavAction } from './nav-actions';
import type { AuthStackParamList } from './types';

/**
 * Perform a navigation action against the root container (imperative): a tapped push, a link, the
 * menu — and a tap in the Alerts list (final review B5), so an alert opens what it is about exactly
 * as its push does, and a new kind of target opens from both.
 */
export function applyNavAction(action: NavAction): void {
  if (!navigationRef.isReady()) return;
  if (action.type === 'link') {
    // As React Navigation opens a link while the app runs: the action its state gives, else that state.
    const nav = getActionFromState(action.state as Parameters<typeof getActionFromState>[0], linkingConfig as Parameters<typeof getActionFromState>[1]);
    if (nav) navigationRef.dispatch(nav);
    else navigationRef.resetRoot(action.state as Parameters<typeof navigationRef.resetRoot>[0]);
    return;
  }
  if (action.type === 'tab') {
    navigationRef.navigate('Tabs', { screen: action.tab });
    return;
  }
  if (action.type === 'auth') {
    // The ref is typed for the app stack; Reset lives in the (signed-out) auth stack.
    (navigationRef as unknown as { navigate: (name: 'Reset', params: AuthStackParamList['Reset']) => void }).navigate(
      'Reset',
      action.params,
    );
    return;
  }
  // A website page opens in the browser, from where it is offered (the menu, Search: 6b).
  if (action.type === 'website') return;
  switch (action.screen) {
    case 'TaskDetail':
      navigationRef.navigate('TaskDetail', action.params);
      break;
    case 'AllBoard':
      navigationRef.navigate('AllBoard');
      break;
    case 'ProjectDetail':
      navigationRef.navigate('ProjectDetail', action.params);
      break;
    case 'MeetingDetail':
      navigationRef.navigate('MeetingDetail', action.params);
      break;
    case 'ChatThread':
      navigationRef.navigate('ChatThread', action.params);
      break;
    case 'MyActionItems':
      navigationRef.navigate('MyActionItems');
      break;
    case 'Calendar':
      navigationRef.navigate('Calendar');
      break;
    case 'Profile':
      navigationRef.navigate('Profile');
      break;
    case 'Reports':
      navigationRef.navigate('Reports');
      break;
    case 'Activity':
      navigationRef.navigate('Activity');
      break;
    case 'Settings':
      navigationRef.navigate('Settings');
      break;
    case 'Search':
      navigationRef.navigate('Search');
      break;
    case 'About':
      navigationRef.navigate('About');
      break;
    case 'Users':
      navigationRef.navigate('Users', action.params);
      break;
  }
}
