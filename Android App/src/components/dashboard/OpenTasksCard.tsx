import { StyleSheet, View } from 'react-native';
import { DASHBOARD_TEXT } from '../../lib/dashboard';
import { isTaskDone } from '../../lib/due-date';
import type { ApiTask } from '../../lib/types';
import { TaskRow } from '../TaskRow';
import { EmptyState, ErrorNote } from '../ui';
import { DashboardSection, RowsSkeleton } from './DashboardSection';

/**
 * "Your open tasks" (everyone but administrators, whose place has the charts): the first eight
 * open tasks assigned to you, each opening the task, and "View all" for My Tasks.
 */
export function OpenTasksCard({
  tasks,
  loading,
  failed,
  retrying,
  onRetry,
  onViewAll,
  onOpenTask,
}: {
  tasks: readonly ApiTask[] | undefined;
  loading: boolean;
  /** The list failed and nothing is kept on the phone (an outage must not read as "nothing open"). */
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onViewAll: () => void;
  onOpenTask: (task: ApiTask) => void;
}) {
  const open = (tasks ?? []).filter((t) => !isTaskDone(t));
  return (
    <DashboardSection title={DASHBOARD_TEXT.openTasks} link={{ label: DASHBOARD_TEXT.viewAll, onPress: onViewAll, a11y: 'View all my tasks' }}>
      {loading ? (
        <RowsSkeleton label="Loading your tasks" rows={6} />
      ) : failed ? (
        <ErrorNote message="Couldn’t load your tasks." onRetry={onRetry} retrying={retrying} />
      ) : open.length === 0 ? (
        <EmptyState title={DASHBOARD_TEXT.noOpen} subtitle={DASHBOARD_TEXT.noOpenBody} />
      ) : (
        <View style={s.list}>
          {open.slice(0, 8).map((t) => (
            <TaskRow key={t.id} task={t} onPress={() => onOpenTask(t)} />
          ))}
        </View>
      )}
    </DashboardSection>
  );
}

const s = StyleSheet.create({ list: { gap: 8 } });
