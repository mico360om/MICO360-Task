import { create } from 'zustand';
import { ApiError } from '../lib/api-client';

/**
 * 1.22: the server's sentence when it refused a change to an archived project ("This project is
 * archived — reopen it first."), shown across the page (components/projects/ArchivedProjectNotice)
 * until dismissed or the page changes — whatever the part of the page that asked shows itself.
 */
interface ArchivedNoticeState {
  message: string | null;
  show: (message: string) => void;
  dismiss: () => void;
}

export const useArchivedNoticeStore = create<ArchivedNoticeState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  dismiss: () => set({ message: null }),
}));

/** The code the server answers an archived project's refused change with (companies/archive-guard.ts). */
export const PROJECT_ARCHIVED_CODE = 'PROJECT_ARCHIVED';

/**
 * The server refused a change because the project is archived. The page already says so in its words
 * (the notice above); a part of the page shouldn't add its own "Please try again".
 */
export function isArchivedRefusal(err: unknown): boolean {
  return err instanceof ApiError && err.code === PROJECT_ARCHIVED_CODE;
}
