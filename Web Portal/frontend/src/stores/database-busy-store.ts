import { create } from 'zustand';

/**
 * 1.23.1: the server's words when its database was away for a moment (503 DATABASE_BUSY — "The database
 * is busy — please try again in a moment."), shown across the page (components/DatabaseBusyNotice)
 * until dismissed or the page changes — whatever the part of the page that asked shows itself.
 */
interface DatabaseBusyState {
  message: string | null;
  show: (message: string) => void;
  dismiss: () => void;
}

export const useDatabaseBusyStore = create<DatabaseBusyState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  dismiss: () => set({ message: null }),
}));
