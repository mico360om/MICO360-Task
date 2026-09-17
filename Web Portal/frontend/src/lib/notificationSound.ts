/**
 * A short, pleasant chat notification chime synthesized with the Web Audio API — no audio
 * asset to bundle, and it degrades to a no-op where Web Audio is unavailable (e.g. jsdom).
 * The user's mute preference persists in localStorage so it applies across pages and sessions.
 */

const MUTE_KEY = 'mico360.chat.soundMuted';

export function isChatMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setChatMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* storage may be unavailable */
  }
}

type WindowWithAudio = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithAudio;
  const AC = w.AudioContext ?? w.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Resume the audio context inside a user gesture (browsers block audio until then).
 * Safe to call repeatedly; a no-op when Web Audio is unavailable.
 */
export function primeAudio(): void {
  const c = getContext();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
}

/** Play the notification chime (a soft two-note rise). No-op when muted or unsupported. */
export function playChime(): void {
  const c = getContext();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume().catch(() => {});
    const now = c.currentTime;
    // A5 → D6, a gentle rising interval.
    const notes: [number, number][] = [
      [880, 0],
      [1174.66, 0.09],
    ];
    for (const [freq, offset] of notes) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {
    /* audio not available */
  }
}
