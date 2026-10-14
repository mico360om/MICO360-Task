import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a dialog's full-screen layer at the end of `<body>`, outside whatever it was opened from.
 *
 * A `position: fixed` layer is laid out against the window only while no ancestor has a transform,
 * a filter or a backdrop-filter. The frosted top bar and the animated page heading both have one,
 * so a dialog opened from a button inside them was placed inside that strip instead: half of it
 * above the screen, out of reach, with only the strip dimmed. In `<body>` it always gets the window.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
