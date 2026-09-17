import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

export type AuthStackParamList = {
  Login: undefined;
  Forgot: undefined;
  Reset: { token?: string } | undefined;
};

export type TabsParamList = {
  Dashboard: undefined;
  MyTasks: undefined;
  Projects: undefined;
  Chat: undefined;
  Notifications: undefined;
  Settings: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabsParamList> | undefined;
  Board: { projectId: string; projectName?: string };
  TaskDetail: { taskId: string; title?: string };
  Calendar: undefined;
  Profile: undefined;
  ChatThread: { conversationId: string; title: string; kind: 'PROJECT' | 'DIRECT' };
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
export type TabScreenProps<T extends keyof TabsParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabsParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
