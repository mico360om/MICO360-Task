import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover lift + border highlight (use for clickable/interactive cards). */
  hover?: boolean;
  children: ReactNode;
}

/** Elevated surface used for panels, tiles and list items. */
export function Card({ hover = false, className = '', children, ...rest }: CardProps) {
  return (
    <div {...rest} className={`card ${hover ? 'card-hover' : ''} ${className}`.trim()}>
      {children}
    </div>
  );
}
