import { describe, expect, it } from 'vitest';
import { WatchTracker, readYouTubeMessage, vimeoSrc, youtubeListening, youtubeSrc } from './video-watch';

describe('WatchTracker: how much was really watched', () => {
  it('playing forward counts; a jump does not; done at 90 %', () => {
    const t = new WatchTracker();
    t.update(0, 100);
    for (let s = 1; s <= 50; s++) t.update(s);
    expect(t.pct).toBe(50);
    t.update(95); // a jump near the end
    expect(t.pct).toBe(50);
    for (let s = 96; s <= 100; s++) t.update(s);
    expect(t.pct).toBe(55);
    expect(t.watchedEnough).toBe(false);
    expect(t.save()).toEqual({ videoSeconds: 100, videoDuration: 100, watchedPct: 55 });
  });

  it('starts from what was saved before (resume)', () => {
    const t = new WatchTracker(85, 85);
    expect(t.save()).toBeNull();
    t.update(85, 200);
    expect(t.pct).toBe(85);
    for (let s = 86; s <= 95; s++) t.update(s);
    expect(t.pct).toBe(90);
    expect(t.watchedEnough).toBe(true);
  });

  it('never more than 100 %, whole numbers in range', () => {
    const t = new WatchTracker(99);
    t.update(0, 10.4);
    for (let s = 0.5; s <= 10.4; s += 0.5) t.update(s);
    expect(t.pct).toBe(100);
    expect(t.save()).toEqual({ videoSeconds: 10, videoDuration: 10, watchedPct: 100 });
  });
});

describe('the YouTube embed’s messages', () => {
  it('the frame’s address: API on, our origin, no related videos, resume', () => {
    const src = new URL(youtubeSrc('https://www.youtube-nocookie.com/embed/abcdefghijk', 'https://task.mico360.com', 125.7));
    expect(src.origin + src.pathname).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk');
    expect(Object.fromEntries(src.searchParams)).toEqual({ enablejsapi: '1', origin: 'https://task.mico360.com', rel: '0', start: '125' });
    expect(new URL(youtubeSrc('https://www.youtube-nocookie.com/embed/abcdefghijk', 'https://x', 2)).searchParams.has('start')).toBe(false);
    expect(vimeoSrc('https://player.vimeo.com/video/123?h=abc')).toBe('https://player.vimeo.com/video/123?h=abc&dnt=1');
    expect(JSON.parse(youtubeListening('f1'))).toEqual({ event: 'listening', id: 'f1', channel: 'widget' });
  });

  it('reads time, state and ready; anything else is ignored', () => {
    expect(readYouTubeMessage(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12.5, duration: 300, playerState: 1 } }))).toEqual({ kind: 'info', currentTime: 12.5, duration: 300, state: 1 });
    expect(readYouTubeMessage(JSON.stringify({ event: 'infoDelivery', info: { volume: 50 } }))).toEqual({ kind: 'info', currentTime: undefined, duration: undefined, state: undefined });
    expect(readYouTubeMessage({ event: 'onStateChange', info: 0 })).toEqual({ kind: 'state', state: 0 });
    expect(readYouTubeMessage('{"event":"onReady"}')).toEqual({ kind: 'ready' });
    expect(readYouTubeMessage('not json')).toBeNull();
    expect(readYouTubeMessage({ event: 'something' })).toBeNull();
    expect(readYouTubeMessage(null)).toBeNull();
  });
});
