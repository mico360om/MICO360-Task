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
  Meetings: undefined;
  Chat: undefined;
  Notifications: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabsParamList> | undefined;
  Board: { projectId: string; projectName?: string };
  ProjectDetail: { projectId: string; projectName?: string };
  TaskDetail: { taskId: string; title?: string };
  MeetingDetail: { meetingId: string; title?: string };
  /** Schedule a meeting (no id; in a project when given), or edit one. */
  MeetingForm: { meetingId?: string; projectId?: string } | undefined;
  /** The final minutes (Final MOM) of a meeting; `start` makes a first draft as it opens. */
  FinalMinutes: { meetingId: string; start?: 'ai' | 'notes' };
  MyActionItems: undefined;
  Calendar: undefined;
  Profile: undefined;
  Reports: undefined;
  Settings: undefined;
  ChatThread: { conversationId: string; title: string; kind: 'PROJECT' | 'DIRECT' };
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
export type TabScreenProps<T extends keyof TabsParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabsParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
