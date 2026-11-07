import { createContext, useContext, type ReactNode } from 'react';
import { portal, type PortalApi } from '../../api/portal';

/**
 * 1.23.7 Which API the Client portal's pages read through: the signed-in client's own (the default), or an
 * administrator's Preview as client (`preview`: the same pages, read-only — every action is shown but disabled,
 * and the preview API refuses writes before anything leaves the page).
 */
interface PortalContextValue {
  api: PortalApi;
  preview: boolean;
}

const PortalContext = createContext<PortalContextValue>({ api: portal, preview: false });

export function PortalApiProvider({ api, preview = false, children }: { api: PortalApi; preview?: boolean; children: ReactNode }) {
  return <PortalContext.Provider value={{ api, preview }}>{children}</PortalContext.Provider>;
}

/** The portal's API for this page (the client's own, or a preview's). */
export const usePortalApi = (): PortalApi => useContext(PortalContext).api;

/** Is this page a Preview as client (read-only)? */
export const usePortalPreview = (): boolean => useContext(PortalContext).preview;

/** What a switched-off action says when pointed at, in a preview. */
export const PREVIEW_HINT = 'Preview — the client can use this; it’s switched off here.';

export interface PreviewOff {
  /** Switched off (a preview). */
  disabled: boolean;
  /** Its hint (a preview), else undefined. */
  title: string | undefined;
  /** Classes so the hint shows on hover, and the button doesn't lift as if it could be pressed. */
  className: string;
}

const ON: PreviewOff = { disabled: false, title: undefined, className: '' };
const OFF: PreviewOff = { disabled: true, title: PREVIEW_HINT, className: 'disabled:!pointer-events-auto disabled:cursor-not-allowed disabled:!translate-y-0' };

/** In a preview every action is shown but switched off, with a hint saying why; for the client it is untouched. */
export const usePreviewOff = (): PreviewOff => (usePortalPreview() ? OFF : ON);
