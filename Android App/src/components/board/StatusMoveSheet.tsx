import React from 'react';
import { useColors } from '../../core/theme';
import { Sheet, FieldLabel } from '../meeting/sheet-kit';
import { Button } from '../ui';
import { MoveOption } from './MoveCardSheet';
import { STATUS_NAME, statusMoveTargets, statusOfTask } from '../../lib/all-board';
import { categoryColorOf } from '../../lib/theme';
import type { ApiTask, ColumnCategory } from '../../lib/types';

/**
 * Change a card's status on the All projects board (4c), opened by long-pressing it (or TalkBack's
 * "Move…"). The phone has no drag and drop, so this says what a drop on the website's board says:
 * one of the other statuses. The card goes into its own project's first column of that kind; a
 * status mixes projects, so its cards keep their order (due date, then priority).
 */
export function StatusMoveSheet({
  task,
  projectName,
  onMove,
  onClose,
}: {
  task: ApiTask | null;
  projectName: string | null;
  onMove: (status: ColumnCategory) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const current = task ? statusOfTask(task) : 'TODO';
  return (
    <Sheet
      visible={!!task}
      title={`Move “${task?.title ?? ''}”`}
      subtitle={task ? [task.key, projectName, `in ${STATUS_NAME[current]}`].filter(Boolean).join(' · ') : null}
      onClose={onClose}
      closeLabel="Close, without moving the task"
      footer={<Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />}
    >
      <FieldLabel>Change its status</FieldLabel>
      {statusMoveTargets(current).map((t) => (
        <MoveOption
          key={t.status}
          label={t.name}
          a11y={`Move to ${t.name}, in ${projectName || 'its project'}’s first “${t.name}” column`}
          dot={categoryColorOf(c, t.status)}
          onPress={() => onMove(t.status)}
        />
      ))}
    </Sheet>
  );
}
