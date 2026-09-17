import type { ReactNode } from 'react';
import { useInView } from '../../lib/useInView';

export interface RevealProps {
  children: ReactNode;
  /** Stagger step (1–5) for sequenced reveals in a grid/list. */
  delay?: 1 | 2 | 3 | 4 | 5;
  className?: string;
}

/** Wraps content so it fades + rises into view on scroll (no-op under reduced motion / no observer). */
export function Reveal({ children, delay, className = '' }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-delay={delay}
      className={`reveal ${inView ? 'is-visible' : ''} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
