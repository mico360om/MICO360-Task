import { create } from 'zustand';

/**
 * The side-drawer open/closed state. A tiny global store (not screen-local) because the trigger
 * lives in the tab-navigator header while the drawer overlay renders at the navigation root, and
 * push/deep-link handlers close it imperatively via `useDrawerStore.getState()`.
 */
interface DrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  toggleDrawer: () => set((s) => ({ open: !s.open })),
}));
