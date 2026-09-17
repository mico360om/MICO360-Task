import { useState } from 'react';
import { Button } from './ui/Button';
import { NewTaskModal } from './NewTaskModal';

export interface NewTaskButtonProps {
  onCreated?: () => void;
  size?: 'sm' | 'md' | 'lg';
  /** Collapse the label to just the icon on small screens (for the header). */
  compact?: boolean;
  className?: string;
}

/** "New Task" button + the global create dialog. Drop it anywhere (header, page). */
export function NewTaskButton({ onCreated, size = 'md', compact = false, className = '' }: NewTaskButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)} className={className} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className={compact ? 'hidden sm:inline' : ''}>New Task</span>
      </Button>
      {open ? <NewTaskModal onClose={() => setOpen(false)} onCreated={onCreated} /> : null}
    </>
  );
}
