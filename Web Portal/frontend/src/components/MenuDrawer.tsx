import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDialog } from '../hooks/useDialog';

/**
 * 1.23.8 The menu sliding in over the page from the left: the phone's ☰ menu, and a tablet's unfolded menu (owner,
 * 10 Nov: unfolding on a tablet covers the page instead of squeezing it). A dialog: focus moves in and stays, Escape,
 * a tap outside or choosing a page closes it, and focus goes back to the button that opened it. It slides in and
 * out in 200 ms (transform only); with reduced motion that is instant (index.css). `onClose` runs once it has gone.
 */
export function MenuDrawer({ onClose, className = '', children }: { onClose: () => void; className?: string; children: (close: () => void) => ReactNode }) {
  const [closing, setClosing] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onClose();
  };
  const close = () => setClosing(true);
  // The slide out ends in `animationend`; where there is no animation (tests, very old browsers) a timer does.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => finishRef.current(), 260);
    return () => clearTimeout(t);
  }, [closing]);
  const dialogRef = useDialog<HTMLDivElement>(close, { initialFocus: 'container' });
  return (
    <div className={`fixed inset-0 z-50 ${className}`}>
      <div data-menu-scrim className={`absolute inset-0 bg-scrim ${closing ? 'animate-scrim-out' : 'animate-fade-in'}`} onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        data-state={closing ? 'closing' : 'open'}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) finish();
        }}
        className={`absolute left-0 top-0 flex h-full w-64 max-w-[85vw] flex-col border-r border-line bg-surface shadow-lift outline-none ${closing ? 'animate-menu-out' : 'animate-menu-in'}`}
      >
        {children(close)}
      </div>
    </div>
  );
}
