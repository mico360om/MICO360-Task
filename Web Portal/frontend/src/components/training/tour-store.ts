import { create } from 'zustand';

/**
 * The first-time tour (owner answer 17): open by itself once for a new account (the server says when), and again
 * whenever the person asks ("Take the tour" on My training, or in the portal's Help & training).
 */
interface TourState {
  open: boolean;
  /** Shown by itself this session already (not again until the next sign-in, whatever the server says). */
  autoShown: boolean;
  start: () => void;
  autoStart: () => void;
  close: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  open: false,
  autoShown: false,
  start: () => set({ open: true }),
  autoStart: () => {
    if (!get().autoShown) set({ open: true, autoShown: true });
  },
  close: () => set({ open: false }),
}));
