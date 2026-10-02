import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  type Theme as NavTheme,
  type LinkingOptions,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as Notifications from 'expo-notifications';
import { useServices, useUserId } from '../core/providers';
import { useProjects } from '../core/queries';
import { useChatRealtime } from '../core/useChatRealtime';
import { useTheme } from '../core/theme';
import { spacing } from '../lib/theme';
import { notificationToTarget } from '../lib/deep-link';
import { useDrawerStore } from '../lib/drawer-store';
import { asyncStore } from '../adapters/async-storage';
import { configureNotifications, addPushTokenListener } from '../adapters/push';
import { navigationRef } from './ref';
import { targetToAction, requiresSession, type NavAction } from './nav-actions';
import { createPendingAction } from './pending-action';
import { LINKING_PREFIXES, linkingConfig } from './linking';
import type { AuthStackParamList, AppStackParamList, TabsParamList } from './types';
import { AppDrawer } from '../components/AppDrawer';

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

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

// Show pushes that arrive while the app is open and create the Android channel (NTF-01).
configureNotifications();

/** Cold-start dedupe: the id of the push whose tap already routed us, so a later plain launch
 *  (getLastNotificationResponseAsync keeps returning the last tap) does not re-navigate. */
const LAST_HANDLED_KEY = 'mico360.lastHandledNotifId';

const TAB_ICON: Record<keyof TabsParamList, string> = {
  Dashboard: '🏠',
  MyTasks: '✓',
  Projects: '🗂',
  Chat: '💬',
  Notifications: '🔔',
  Settings: '⚙️',
};

/**
 * URL deep links (A0.3, MOB-09): mico360://task/<id>, mico360://project/<id>,
 * mico360://notifications and the e-mailed https://task.mico360.com/reset?token=… link.
 */
// Typed against the app stack (the container ref's param list); the config also names the
// signed-out auth screens, which React Navigation resolves when that stack is mounted.
const linking = {
  prefixes: LINKING_PREFIXES,
  config: linkingConfig,
} as unknown as LinkingOptions<AppStackParamList>;

/** Perform a navigation action against the root container (imperative: push taps, deep links, drawer). */
function applyAction(action: NavAction): void {
  if (!navigationRef.isReady()) return;
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
  switch (action.screen) {
    case 'TaskDetail':
      navigationRef.navigate('TaskDetail', action.params);
      break;
    case 'Board':
      navigationRef.navigate('Board', action.params);
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
  }
}

/** Subscribes to live chat events app-wide (A2.3) so the Chat inbox and threads stay current
 *  without polling. Rendered only when signed in; joins the user's project channel rooms. */
function ChatRealtimeMount() {
  const { data: projects } = useProjects();
  useChatRealtime((projects ?? []).map((p) => p.id));
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
  const { colors } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.brand },
        headerTintColor: colors.onBrand,
        headerTitleStyle: { fontWeight: '700' },
        headerLeft: () => <HamburgerButton />,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>{TAB_ICON[route.name]}</Text>,
      })}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Home' }} />
      <Tabs.Screen name="MyTasks" component={MyTasksScreen} options={{ title: 'My Tasks' }} />
      <Tabs.Screen name="Projects" component={ProjectsScreen} options={{ title: 'Projects' }} />
      <Tabs.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} />
      <Tabs.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Alerts' }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
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

  // Deep-link on push tap while the app is running/backgrounded (A6.2): route to the entity.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      dispatch(targetToAction(notificationToTarget(data)));
    });
    return () => sub.remove();
  }, [dispatch]);

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
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking} onReady={flushPending}>
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
            <AppStack.Screen
              name="ProjectDetail"
              component={ProjectDetailScreen}
              options={({ route }) => ({ title: route.params.projectName ?? 'Project' })}
            />
            <AppStack.Screen
              name="TaskDetail"
              component={TaskDetailScreen}
              options={({ route }) => ({ title: route.params.title ?? 'Task' })}
            />
            <AppStack.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Calendar' }} />
            <AppStack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
            <AppStack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
            <AppStack.Screen name="ChatThread" component={ChatThreadScreen} options={{ title: 'Chat' }} />
          </AppStack.Navigator>
          <AppDrawer onNavigate={applyAction} />
          <ChatRealtimeMount />
          <PushRegistrationMount />
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
