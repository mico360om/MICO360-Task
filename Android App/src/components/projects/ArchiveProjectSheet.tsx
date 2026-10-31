import { Text } from 'react-native';
import { ARCHIVE_TEXT } from '../../lib/project-status';
import { typeStyle } from '../../lib/typography';
import type { ProjectOverview } from '../../lib/types';
import { useColors } from '../../core/theme';
import { Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';

/**
 * "Archive Rig?", as the website asks before it archives a project: where it goes, that its tasks
 * stay, and that its status can be changed back. A refused archive says so here.
 */
export function ArchiveProjectSheet({
  project,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  project: ProjectOverview | null;
  busy: boolean;
  error: string | null;
  onConfirm: (project: ProjectOverview) => void;
  onClose: () => void;
}) {
  const c = useColors();
  return (
    <Sheet
      visible={!!project}
      title={project ? ARCHIVE_TEXT.title(project.name) : ''}
      onClose={onClose}
      footer={<SheetButtons onCancel={onClose} confirm={ARCHIVE_TEXT.confirm} onConfirm={() => project && onConfirm(project)} busy={busy} />}
    >
      <Text style={[typeStyle('body'), { color: c.ink2 }]}>{ARCHIVE_TEXT.body}</Text>
      <SheetMessage text={error} />
    </Sheet>
  );
}
