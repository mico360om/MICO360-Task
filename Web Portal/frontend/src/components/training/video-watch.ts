/**
 * Lesson videos (design call 4): progress from the players' own events, never by loading a provider's script.
 *
 *  - YouTube: the privacy embed with `enablejsapi=1` and our origin; the page says `listening` to the frame
 *    (postMessage) and the frame answers with `infoDelivery` (currentTime, duration, playerState) and
 *    `onStateChange` messages. Only messages from YouTube's own origins, from that frame, are read.
 *  - Vimeo: the bundled @vimeo/player on the frame (timeupdate, ended).
 *
 * The WatchTracker turns those times into how much was really watched: only playing forward in small steps
 * counts (a jump to the end is not watching it). The lesson is done at 90 %.
 */

export const WATCHED_DONE_PCT = 90;
/** The most a step between two time reports may be and still count as playing (2× speed, a slow report). */
const PLAY_STEP_MAX = 3;

export class WatchTracker {
  private watched: number | null = null;
  private last: number | null = null;
  private startPct: number;
  position = 0;
  duration = 0;

  constructor(startWatchedPct = 0, startPosition = 0) {
    this.startPct = Math.max(0, Math.min(100, startWatchedPct));
    this.position = Math.max(0, startPosition);
  }

  /** A time report from the player (seconds). */
  update(current: number | undefined, duration?: number): void {
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) this.duration = duration;
    if (this.duration > 0 && this.watched === null) this.watched = (this.startPct / 100) * this.duration;
    if (typeof current !== 'number' || !Number.isFinite(current) || current < 0) return;
    if (this.last !== null && this.watched !== null) {
      const step = current - this.last;
      if (step > 0 && step <= PLAY_STEP_MAX) this.watched = Math.min(this.duration, this.watched + step);
    }
    this.last = current;
    this.position = current;
  }

  /** Watched share, 0–100 (whole number, never more than 100). */
  get pct(): number {
    if (this.duration <= 0) return Math.floor(this.startPct);
    return Math.max(0, Math.min(100, Math.floor(((this.watched ?? 0) / this.duration) * 100)));
  }

  get watchedEnough(): boolean {
    return this.pct >= WATCHED_DONE_PCT;
  }

  /** What PUT …/progress saves (whole numbers, in the server's ranges); null before the duration is known. */
  save(): { videoSeconds: number; videoDuration: number; watchedPct: number } | null {
    if (this.duration <= 0) return null;
    return {
      videoSeconds: Math.min(86_400, Math.max(0, Math.floor(this.position))),
      videoDuration: Math.min(86_400, Math.max(1, Math.round(this.duration))),
      watchedPct: this.pct,
    };
  }
}

// ── YouTube's embed, through postMessage ──

/** YouTube's frames speak from these origins only. */
export const YOUTUBE_ORIGIN = /^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com$/;

/** The embed's address: the API on, our origin named, no other channels' videos at the end, resuming at `start`. */
export function youtubeSrc(embedUrl: string, origin: string, startSeconds = 0): string {
  const u = new URL(embedUrl);
  u.searchParams.set('enablejsapi', '1');
  u.searchParams.set('origin', origin);
  u.searchParams.set('rel', '0');
  if (startSeconds >= 5) u.searchParams.set('start', String(Math.floor(startSeconds)));
  return u.toString();
}

/** The Vimeo embed's address (no tracking cookies; an unlisted video keeps its `h`). */
export function vimeoSrc(embedUrl: string): string {
  const u = new URL(embedUrl);
  u.searchParams.set('dnt', '1');
  return u.toString();
}

/** "Start telling me": YouTube then sends infoDelivery messages. */
export const youtubeListening = (id: string) => JSON.stringify({ event: 'listening', id, channel: 'widget' });
/** "Tell me when the state changes" (ended, paused, playing). */
export const youtubeSubscribe = (id: string, event: 'onStateChange' | 'onReady') =>
  JSON.stringify({ event: 'command', func: 'addEventListener', args: [event], id, channel: 'widget' });

export type YouTubeEvent = { kind: 'info'; currentTime?: number; duration?: number; state?: number } | { kind: 'state'; state: number } | { kind: 'ready' };

/** YouTube's player states: ended 0, playing 1, paused 2. */
export const YT_ENDED = 0;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A message from the frame → what it says (null for anything else). */
export function readYouTubeMessage(data: unknown): YouTubeEvent | null {
  let msg: unknown = data;
  if (typeof data === 'string') {
    try {
      msg = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { event?: unknown; info?: unknown };
  if (m.event === 'onReady') return { kind: 'ready' };
  if (m.event === 'onStateChange' && typeof m.info === 'number') return { kind: 'state', state: m.info };
  if ((m.event === 'infoDelivery' || m.event === 'initialDelivery') && m.info && typeof m.info === 'object') {
    const info = m.info as Record<string, unknown>;
    return { kind: 'info', currentTime: num(info.currentTime), duration: num(info.duration), state: num(info.playerState) };
  }
  return null;
}
