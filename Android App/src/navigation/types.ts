import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { ColumnCategory } from '../lib/types';

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
  /** Every open project's tasks for a day under the six shared statuses (4c). */
  AllBoard: undefined;
  /** Manage columns (4b): for an administrator or a manager of the project. */
  BoardColumns: { projectId: string; projectName?: string };
  ProjectDetail: { projectId: string; projectName?: string };
  TaskDetail: { taskId: string; title?: string };
  /**
   * New task (4a): in a fixed project (a board, a project; with the board’s column and day), or
   * starting in a project that can be changed (the calendar’s filter), on a day (the calendar’s).
   * `columnCategory`: start in that kind of column of whichever project is chosen (the All projects
   * board’s “+” on a status — 4c). `taskId`: Edit task — the same form, filled with that task (4d).
   */
  NewTask: { projectId?: string; defaultProjectId?: string; columnId?: string; columnCategory?: ColumnCategory; dueDate?: string; boardDate?: string; taskId?: string } | undefined;
  MeetingDetail: { meetingId: string; title?: string };
  /** Schedule a meeting (no id; in a project when given), or edit one. */
  MeetingForm: { meetingId?: string; projectId?: string } | undefined;
  /** The final minutes (Final MOM) of a meeting; `start` makes a first draft as it opens. */
  FinalMinutes: { meetingId: string; start?: 'ai' | 'notes' };
  MyActionItems: undefined;
  Calendar: undefined;
  Profile: undefined;
  Reports: undefined;
  /** Who did what across your projects, as the website's Activity page (5c). */
  Activity: undefined;
  Settings: undefined;
  /**
   * A conversation; the title is a hint (the thread names itself from the inbox, e.g. opened from a
   * push). `jumpTo`: a message to show (a search result), loading older pages to find it (3b).
   */
  ChatThread: { conversationId: string; title?: string; jumpTo?: string };
  /** New project (no id) or Edit project — administrators (5b). */
  ProjectForm: { projectId?: string } | undefined;
  /** Find tasks, projects, people, meetings and pages, as the website's search box (6b). */
  Search: undefined;
  /** This app's and the website's versions, and the version history (6b). */
  About: undefined;
  /** User Management — administrators (6b). `q` starts the list's search (a person found by Search). */
  Users: { q?: string } | undefined;
  /** New user (no id) or Manage account — administrators (6b). */
  UserForm: { userId?: string } | undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
export type TabScreenProps<T extends keyof TabsParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabsParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
