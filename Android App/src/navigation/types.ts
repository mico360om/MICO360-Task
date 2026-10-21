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
  /**
   * New task (4a): in a fixed project (a board, a project; with the board’s column and day), or
   * starting in a project that can be changed (the calendar’s filter), on a day (the calendar’s).
   */
  NewTask: { projectId?: string; defaultProjectId?: string; columnId?: string; dueDate?: string; boardDate?: string } | undefined;
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
  /**
   * A conversation; the title is a hint (the thread names itself from the inbox, e.g. opened from a
   * push). `jumpTo`: a message to show (a search result), loading older pages to find it (3b).
   */
  ChatThread: { conversationId: string; title?: string; jumpTo?: string };
  /** New project (no id) or Edit project — administrators (5b). */
  ProjectForm: { projectId?: string } | undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
export type TabScreenProps<T extends keyof TabsParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabsParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
