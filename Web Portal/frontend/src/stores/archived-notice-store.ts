import { create } from 'zustand';

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
