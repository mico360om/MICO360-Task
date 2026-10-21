import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Pressable, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  getActionFromState,
  getStateFromPath,
  type Theme as NavTheme,
  type LinkingOptions,
  type InitialState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as Notifications from 'expo-notifications';
import { useServices, useUserId } from '../core/providers';
import { useProjects } from '../core/queries';
import { useAppRealtime } from '../core/useAppRealtime';
import { useChatBadge } from '../core/chat';
import { useDeliveryAcks } from '../core/chat-features';
import { chatTabBadge, chatTabLabel } from '../lib/chat';
import { useTheme } from '../core/theme';
import { spacing } from '../lib/theme';
import { notificationToTarget } from '../lib/deep-link';
import { useDrawerStore } from '../lib/drawer-store';
import { dateZones, subscribeTimeZone } from '../lib/due-date';
import { useDateSettingsLoad } from '../core/calendar-queries';
import { asyncStore } from '../adapters/async-storage';
import { configureNotifications, addPushTokenListener } from '../adapters/push';
import { navigationRef } from './ref';
import { targetToAction, requiresSession, chatScreenId, meetingScreenId, taskScreenId, type NavAction } from './nav-actions';
import { createPendingAction } from './pending-action';
import { LINKING_PREFIXES, holdUntilSignedIn, linkingConfig, normalizeLinkPath, withoutLinkTitles } from './linking';
import type { AuthStackParamList, AppStackParamList, TabsParamList } from './types';
import { TAB_ITEMS, type TabName } from './tabs';
import { AppDrawer } from '../components/AppDrawer';
import { UpdateBanner } from '../components/UpdateBanner';

import { LoginScreen } from '../screens/auth/LoginScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { MyTasksScreen } from '../screens/MyTasksScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { BoardScreen } from '../screens/BoardScreen';
import { ProjectDetailScreen } from '../screens/ProjectDetailScreen';
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ChatThreadScreen } from '../screens/ChatThreadScreen';
import { MeetingsScreen } from '../screens/MeetingsScreen';
import { MeetingDetailScreen } from '../screens/MeetingDetailScreen';
import { MyActionItemsScreen } from '../screens/MyActionItemsScreen';
import { MeetingFormScreen } from '../screens/MeetingFormScreen';
import { FinalMinutesScreen } from '../screens/FinalMinutesScreen';
import { NewTaskScreen } from '../screens/NewTaskScreen';
import { ProjectFormScreen } from '../screens/ProjectFormScreen';
import { BoardColumnsScreen } from '../screens/BoardColumnsScreen';
import { AllBoardScreen } from '../screens/AllBoardScreen';
import { ALL_PROJECTS_TEXT } from '../lib/all-board';
import { ActivityScreen } from '../screens/ActivityScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { UsersScreen } from '../screens/UsersScreen';
import { UserFormScreen } from '../screens/UserFormScreen';
import { SearchButton } from '../components/SearchButton';
import { useAlertsCount, useAlertsLive, usePushOpened } from '../core/alerts';
import { alertsBadge, alertsTabLabel } from '../lib/alerts';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

// Show pushes that arrive while the app is open and create the Android channel (NTF-01).
configureNotifications();

/** Cold-start dedupe: the id of the push whose tap already routed us, so a later plain launch
 *  (getLastNotificationResponseAsync keeps returning the last tap) does not re-navigate. */
const LAST_HANDLED_KEY = 'mico360.lastHandledNotifId';

const TAB_SCREENS: Record<TabName, React.ComponentType<never>> = {
  Dashboard: DashboardScreen,
  MyTasks: MyTasksScreen,
  Projects: ProjectsScreen,
  Meetings: MeetingsScreen,
  Chat: ChatScreen,
  Notifications: NotificationsScreen,
};
const TAB_ICON = Object.fromEntries(TAB_ITEMS.map((t) => [t.name, t.icon])) as Record<TabName, string>;

/**
 * URL deep links (A0.3, MOB-09): mico360://task/<id>, mico360://project/<id>,
 * mico360://meeting/<id>, mico360://notifications, the website's addresses (6b) and the e-mailed
 * https://task.mico360.com/reset?token=… link. A link that needs a signed-in user, tapped while
 * signed out, waits for the sign-in like a tapped push (holdUntilSignedIn, 6b review).
 */
// Typed against the app stack (the container ref's param list); the config also names the
// signed-out auth screens, which React Navigation resolves when that stack is mounted.
function createLinking(session: { signedIn: () => boolean; hold: (action: NavAction) => void }): LinkingOptions<AppStackParamList> {
  return {
    prefixes: LINKING_PREFIXES,
    config: linkingConfig,
    // The website's addresses (/meetings/<id>, ?task=<id>, …) open the same screens as the app's own
    // links (normalizeLinkPath, 6b). A link longer than any real one opens nothing: it is dropped
    // before React Navigation matches it to a screen, so it never keeps the JS thread busy (6b review).
    // A link never names a screen (?title=…): only the app sets the titles of the screens it opens.
    getStateFromPath: (path: string, options: Parameters<typeof getStateFromPath>[1]) =>
      holdUntilSignedIn(withoutLinkTitles(getStateFromPath(normalizeLinkPath(path), options)), { signedIn: session.signedIn(), hold: session.hold }),
  } as unknown as LinkingOptions<AppStackParamList>;
}

/** Perform a navigation action against the root container (imperative: push taps, deep links, drawer). */
function applyAction(action: NavAction): void {
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
    case 'Board':
      navigationRef.navigate('Board', action.params);
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

/** Subscribes to live chat and meeting events app-wide (A2.3, 2a) on one socket, so the Chat inbox,
 *  threads and meetings stay current without polling. Rendered only when signed in; joins the user's
 *  project rooms. */
function RealtimeMount() {
  const { data: projects } = useProjects();
  useAppRealtime((projects ?? []).map((p) => p.id));
  // A direct message that reached this phone: its sender sees "Delivered" (3b).
  useDeliveryAcks();
  return null;
}

/**
 * Keeps this phone's push token registered to the signed-in user (NTF-01, MOB-11): on every launch
 * while signed in and right after sign-in (mount), and whenever FCM rotates the token. A denied
 * permission or a build without Firebase simply yields no token — Settings shows how to turn
 * notifications on.
 */
function PushRegistrationMount() {
  const { push } = useServices();
  useEffect(() => {
    void push.register().catch(() => {
      /* offline — retried on the next launch / rotation */
    });
    const sub = addPushTokenListener((token) => {
      void push.register(token).catch(() => {});
    });
    return () => sub.remove();
  }, [push]);
  return null;
}

/**
 * Dates follow the website: the company's time zone everywhere, your own on the calendar, with
 * your week start (core/calendar-queries useDateSettingsLoad). Loaded once signed in and whenever
 * the app comes back to the front.
 */
function TimeZoneMount() {
  useDateSettingsLoad();
  return null;
}

/**
 * Alerts stay current while signed in (5c): the unread count every 30 s in front, the list and count
 * again on a push and on coming back to the app, and the app icon's number (lib/alerts' badge rule).
 */
function AlertsMount() {
  useAlertsLive();
  return null;
}

function HamburgerButton() {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      hitSlop={12}
      onPress={() => useDrawerStore.getState().openDrawer()}
      style={{ paddingHorizontal: spacing.lg }}
    >
      <Text style={{ fontSize: 20, color: colors.onBrand }}>☰</Text>
    </Pressable>
  );
}

function MainTabs() {
  // Unread alerts (5c): the Alerts tab's number, as the website's bell.
  const alerts = useAlertsCount();
  const { colors } = useTheme();
  // Unread chat messages (3a): without muted conversations or the one being read.
  const unread = useChatBadge();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.brand },
        headerTintColor: colors.onBrand,
        headerTitleStyle: { fontWeight: '700' },
        headerLeft: () => <HamburgerButton />,
        // Search from every tab, as the website's search box on every page (6b).
        headerRight: () => <SearchButton />,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>{TAB_ICON[route.name]}</Text>,
        ...(route.name === 'Notifications'
          ? { tabBarBadge: alertsBadge(alerts), tabBarAccessibilityLabel: alertsTabLabel(alerts), tabBarBadgeStyle: { backgroundColor: colors.brand, color: colors.onBrand } }
          : {}),
      })}
    >
      {/* Six tabs, in the side menu's order; Settings is in the menu (navigation/tabs). */}
      {TAB_ITEMS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          component={TAB_SCREENS[t.name] as React.ComponentType}
          options={
            t.name === 'Chat'
              ? { title: t.title, tabBarBadge: chatTabBadge(unread), tabBarAccessibilityLabel: chatTabLabel(unread), tabBarBadgeStyle: { backgroundColor: colors.brand, color: colors.onBrand } }
              : { title: t.title }
          }
        />
      ))}
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  // A new time zone opens the screens again where they were, so every date follows at once (React
  // Navigation doesn't re-render a mounted screen when its parent does). It happens only when an
  // admin or you change a zone; the last zones are restored before the first screen shows.
  const zones = useSyncExternalStore(subscribeTimeZone, dateZones);
  const zoneKey = `${zones.company}|${zones.own ?? ''}`;
  const reopen = useRef<{ key: string; state: InitialState | undefined }>({ key: zoneKey, state: undefined });
  if (reopen.current.key !== zoneKey) {
    reopen.current = { key: zoneKey, state: navigationRef.isReady() ? navigationRef.getRootState() : undefined };
  }
  const userId = useUserId();
  const signedIn = !!userId;
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const { colors, scheme } = useTheme();

  // An action that cannot run yet waits here: the container is not ready (cold start), or a push
  // was tapped while signed out — it is kept until the user signs in (WEB-18).
  const pending = useRef(createPendingAction()).current;
  const flushPending = useCallback(() => {
    const action = pending.peek();
    if (!action || !navigationRef.isReady()) return;
    if (requiresSession(action) !== signedInRef.current) return; // wrong stack mounted — wait
    pending.take();
    applyAction(action);
  }, [pending]);

  /** Run now if possible, otherwise keep it until the right stack is mounted. */
  const dispatch = useCallback(
    (action: NavAction) => {
      pending.set(action);
      flushPending();
    },
    [pending, flushPending],
  );

  // Signing in (or out) swaps the mounted stack: run whatever was waiting for it.
  useEffect(() => {
    const t = setTimeout(flushPending, 0);
    return () => clearTimeout(t);
  }, [signedIn, flushPending]);

  // A link tapped while signed out is kept here too, and opens after the sign-in (6b review).
  const linking = useMemo(() => createLinking({ signedIn: () => signedInRef.current, hold: (action) => pending.set(action) }), [pending]);

  const navTheme: NavTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: colors.brand,
      background: colors.ground,
      card: colors.surface,
      text: colors.ink,
      border: colors.line,
    },
  };

  const appHeader = {
    headerStyle: { backgroundColor: colors.brand },
    headerTintColor: colors.onBrand,
    headerTitleStyle: { fontWeight: '700' as const },
  };

  // A push opened from the phone's list reads its alert, as clicking it on the website does (5c).
  const pushOpened = usePushOpened();

  // Deep-link on push tap while the app is running/backgrounded (A6.2): route to the entity.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      dispatch(targetToAction(notificationToTarget(data)));
      pushOpened(data);
    });
    return () => sub.remove();
  }, [dispatch, pushOpened]);

  // Cold start: the app was launched by tapping a push while it was killed (A6.2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await Notifications.getLastNotificationResponseAsync().catch(() => null);
      if (!response || cancelled) return;
      const id = response.notification.request.identifier;
      const last = await asyncStore.getItem(LAST_HANDLED_KEY).catch(() => null);
      if (last === id) return; // already routed for this notification on a previous launch
      await asyncStore.setItem(LAST_HANDLED_KEY, id).catch(() => {});
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      dispatch(targetToAction(notificationToTarget(data))); // runs now, onReady, or after sign-in
      pushOpened(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, pushOpened]);

  return (
    <NavigationContainer
      key={zoneKey}
      ref={navigationRef}
      theme={navTheme}
      linking={linking}
      initialState={reopen.current.state}
      onReady={flushPending}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {signedIn ? (
        <>
          <AppStack.Navigator screenOptions={appHeader}>
            <AppStack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
            <AppStack.Screen
              name="Board"
              component={BoardScreen}
              options={({ route }) => ({ title: route.params.projectName ?? 'Board' })}
            />
            <AppStack.Screen name="BoardColumns" component={BoardColumnsScreen} options={{ title: 'Manage columns' }} />
            <AppStack.Screen name="AllBoard" component={AllBoardScreen} options={{ title: ALL_PROJECTS_TEXT.title }} />
            <AppStack.Screen
              name="ProjectDetail"
              component={ProjectDetailScreen}
              options={({ route }) => ({ title: route.params.projectName ?? 'Project' })}
            />
            <AppStack.Screen
              name="TaskDetail"
              component={TaskDetailScreen}
              getId={taskScreenId}
              options={({ route }) => ({ title: route.params.title ?? 'Task' })}
            />
            <AppStack.Screen
              name="MeetingDetail"
              component={MeetingDetailScreen}
              getId={meetingScreenId}
              options={({ route }) => ({ title: route.params.title ?? 'Meeting' })}
            />
            <AppStack.Screen
              name="MeetingForm"
              component={MeetingFormScreen}
              options={({ route }) => ({ title: route.params?.meetingId ? 'Edit meeting' : 'Schedule a meeting' })}
            />
            <AppStack.Screen name="NewTask" component={NewTaskScreen} options={({ route }) => ({ title: route.params?.taskId ? 'Edit task' : 'New task' })} />
            <AppStack.Screen name="FinalMinutes" component={FinalMinutesScreen} options={{ title: 'Final MOM' }} />
            <AppStack.Screen name="MyActionItems" component={MyActionItemsScreen} options={{ title: 'My Action Items' }} />
            <AppStack.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Calendar' }} />
            <AppStack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
            <AppStack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
            <AppStack.Screen name="Activity" component={ActivityScreen} options={{ title: 'Activity' }} />
            <AppStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            <AppStack.Screen
              name="ChatThread"
              component={ChatThreadScreen}
              getId={chatScreenId}
              options={({ route }) => ({ title: route.params.title ?? 'Chat' })}
            />
            <AppStack.Screen
              name="ProjectForm"
              component={ProjectFormScreen}
              options={({ route }) => ({ title: route.params?.projectId ? 'Edit project' : 'New project' })}
            />
            <AppStack.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
            <AppStack.Screen name="About" component={AboutScreen} options={{ title: 'About MICO360 Tasks' }} />
            <AppStack.Screen name="Users" component={UsersScreen} options={{ title: 'User Management' }} />
            <AppStack.Screen
              name="UserForm"
              component={UserFormScreen}
              options={({ route }) => ({ title: route.params?.userId ? 'Manage account' : 'New user' })}
            />
          </AppStack.Navigator>
          <AppDrawer onNavigate={applyAction} />
          <RealtimeMount />
          <PushRegistrationMount />
          <TimeZoneMount />
          <AlertsMount />
          <UpdateBanner />
        </>
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
          <AuthStack.Screen name="Forgot" component={ForgotPasswordScreen} />
          <AuthStack.Screen name="Reset" component={ResetPasswordScreen} />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}
