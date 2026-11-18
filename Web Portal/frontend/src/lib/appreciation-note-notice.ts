import { create } from 'zustand';

/**
 * 1.24.1 Appreciation note: an accept with a note, but the appreciation had already been accepted (another device,
 * or an earlier try): the note is not added. Said once in the Dashboard banner (a plain notice, not an error),
 * whether the accept was online (the popup or the banner) or replayed from the offline queue.
 */
export const NOTE_NOT_ADDED = 'This appreciation was already accepted, so your note wasn’t added.';

export const useNoteNotice = create<{ text: string | null }>(() => ({ text: null }));

export const showNoteNotAdded = (): void => useNoteNotice.setState({ text: NOTE_NOT_ADDED });
export const clearNoteNotice = (): void => useNoteNotice.setState({ text: null });
