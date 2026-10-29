import { useState } from 'react';
import { Button } from './ui/Button';
import { NewTaskModal } from './NewTaskModal';
import { useShortcut } from './shortcuts/ShortcutProvider';
import { TOUCH_TALL } from '../lib/touch';

export interface NewTaskButtonProps {
  onCreated?: () => void;
  size?: 'sm' | 'md' | 'lg';
  /** Collapse the label to just the icon on small screens (for the header). */
  compact?: boolean;
  className?: string;
  /** The N shortcut's priority: the header's button passes 0 so a page's own "New …" wins. */
  shortcutPriority?: number;
}

/** "New Task" button + the global create dialog. Drop it anywhere (header, page). */
export function NewTaskButton({ onCreated, size = 'md', compact = false, className = '', shortcutPriority }: NewTaskButtonProps) {
  const [open, setOpen] = useState(false);
  useShortcut('new', () => setOpen(true), { priority: shortcutPriority });
  return (
    <>
      {/* 44px tall on a touch screen, wherever it is (a page's header gave it 36px). */}
      <Button size={size} onClick={() => setOpen(true)} className={`${TOUCH_TALL} ${className}`.trim()} aria-haspopup="dialog" aria-label={compact ? 'New Task' : undefined} title="New task" shortcut="new">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className={compact ? 'hidden sm:inline' : ''}>New Task</span>
      </Button>
      {open ? <NewTaskModal onClose={() => setOpen(false)} onCreated={onCreated} /> : null}
    </>
  );
}
