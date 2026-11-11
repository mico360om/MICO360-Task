import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { VideoLesson } from './VideoLesson';
import { fakeLearner, lesson, renderOnSide } from './training-fixtures';

/** The bundled Vimeo player, replaced: the test plays its events. */
const vimeo = vi.hoisted(() => {
  const handlers: Record<string, (d: { seconds: number; duration: number; percent: number }) => void> = {};
  const instance = {
    on: vi.fn((e: string, f: (d: { seconds: number; duration: number; percent: number }) => void) => {
      handlers[e] = f;
    }),
    off: vi.fn(),
    ready: vi.fn(async () => undefined),
    setCurrentTime: vi.fn(async (s: number) => s),
  };
  const ctor = vi.fn(function () {
    return instance;
  });
  return { handlers, instance, ctor };
});
vi.mock('@vimeo/player', () => ({ default: vimeo.ctor }));

const YT = { provider: 'YOUTUBE' as const, videoId: 'abcdefghijk', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk', watchUrl: 'https://www.youtube.com/watch?v=abcdefghijk' };
const VIMEO = { provider: 'VIMEO' as const, videoId: '76979871', embedUrl: 'https://player.vimeo.com/video/76979871?h=8272103f6e', watchUrl: 'https://vimeo.com/76979871/8272103f6e' };

afterEach(() => {
  vi.useRealTimers();
  vimeo.ctor.mockClear();
  vimeo.instance.setCurrentTime.mockClear();
});

describe('a video lesson: YouTube through its embed’s messages (no YouTube script)', () => {
  it('says “listening”, reads the time, saves every 5 s and is done at 90 % watched', async () => {
    vi.useFakeTimers();
    const api = fakeLearner();
    const onDone = vi.fn();
    const { container } = renderOnSide(<VideoLesson lesson={lesson({ kind: 'VIDEO', video: YT, progress: { done: false, videoSeconds: 10, watchedPct: 0, stepIndex: 0 } })} onDone={onDone} />, { api });
    const frame = container.querySelector('iframe')!;
    const src = new URL(frame.src);
    expect(src.origin + src.pathname).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk');
    expect(src.searchParams.get('enablejsapi')).toBe('1');
    expect(src.searchParams.get('origin')).toBe(window.location.origin);
    expect(src.searchParams.get('rel')).toBe('0');
    expect(src.searchParams.get('start')).toBe('10');
    expect(document.querySelector('script[src*="youtube"]')).toBeNull();

    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    act(() => void vi.advanceTimersByTime(600));
    expect(post).toHaveBeenCalledWith(expect.stringContaining('"event":"listening"'), 'https://www.youtube-nocookie.com');

    const send = (data: unknown, origin = 'https://www.youtube-nocookie.com') =>
      act(() => void window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin, source: frame.contentWindow })));
    send({ event: 'infoDelivery', info: { currentTime: 10, duration: 100, playerState: 1 } });
    expect(api.saveProgress).toHaveBeenCalledTimes(1);
    expect(api.saveProgress).toHaveBeenLastCalledWith('l2', { videoSeconds: 10, videoDuration: 100, watchedPct: 0 });
    // Four more seconds: not saved again yet; the fifth: saved.
    for (let t = 11; t <= 14; t++) {
      act(() => void vi.advanceTimersByTime(1000));
      send({ event: 'infoDelivery', info: { currentTime: t } });
    }
    expect(api.saveProgress).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(1000));
    send({ event: 'infoDelivery', info: { currentTime: 15 } });
    expect(api.saveProgress).toHaveBeenCalledTimes(2);
    expect(api.saveProgress).toHaveBeenLastCalledWith('l2', { videoSeconds: 15, videoDuration: 100, watchedPct: 5 });
    expect(screen.getByText('Watched 5% — the lesson is done at 90%.')).toBeInTheDocument();

    // Messages from anywhere else are ignored.
    send({ event: 'infoDelivery', info: { currentTime: 16 } }, 'https://evil.example');
    expect(screen.getByText('Watched 5% — the lesson is done at 90%.')).toBeInTheDocument();

    // A jump to the end doesn't count as watching.
    send({ event: 'infoDelivery', info: { currentTime: 99 } });
    expect(api.complete).not.toHaveBeenCalled();
    // Watching on from 15 to 100 does: 90 % → done, once.
    send({ event: 'infoDelivery', info: { currentTime: 15 } });
    for (let t = 16; t <= 100; t++) send({ event: 'infoDelivery', info: { currentTime: t } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(api.complete).toHaveBeenCalledWith('l2');
    expect(api.saveProgress).toHaveBeenLastCalledWith('l2', expect.objectContaining({ watchedPct: 90 }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ nextLessonId: 'l3' }));
    expect(screen.getByText('Watched')).toBeInTheDocument();
  });

  it('the link to open it on YouTube is always there', () => {
    renderOnSide(<VideoLesson lesson={lesson({ kind: 'VIDEO', video: YT })} onDone={vi.fn()} />, { api: fakeLearner() });
    expect(screen.getByRole('link', { name: /Open the video on YouTube/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk');
  });

  it('no events from the player: “Mark as watched” after the lesson’s minimum time', async () => {
    vi.useFakeTimers();
    const api = fakeLearner();
    const onDone = vi.fn();
    renderOnSide(<VideoLesson lesson={lesson({ kind: 'VIDEO', video: YT, watchFallbackSeconds: 30 })} onDone={onDone} />, { api });
    act(() => void vi.advanceTimersByTime(29_000));
    expect(screen.queryByRole('button', { name: 'Mark as watched' })).toBeNull();
    act(() => void vi.advanceTimersByTime(1_000));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as watched' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.complete).toHaveBeenCalledWith('l2');
    expect(onDone).toHaveBeenCalled();
  });

  it('a lesson whose link isn’t added yet: “Video coming soon”', () => {
    renderOnSide(<VideoLesson lesson={lesson({ kind: 'VIDEO', video: null })} onDone={vi.fn()} />, { api: fakeLearner() });
    expect(screen.getByText('Video coming soon')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('a video lesson: Vimeo through the bundled player', () => {
  it('follows timeupdate, resumes where it stopped and is done at 90 %', async () => {
    const api = fakeLearner();
    const onDone = vi.fn();
    const { container } = renderOnSide(<VideoLesson lesson={lesson({ kind: 'VIDEO', video: VIMEO, progress: { done: false, videoSeconds: 40, watchedPct: 40, stepIndex: 0 } })} onDone={onDone} />, { api });
    const frame = container.querySelector('iframe')!;
    expect(frame.src).toBe('https://player.vimeo.com/video/76979871?h=8272103f6e&dnt=1');
    expect(vimeo.ctor).toHaveBeenCalledWith(frame);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vimeo.instance.setCurrentTime).toHaveBeenCalledWith(40);
    act(() => vimeo.handlers.timeupdate!({ seconds: 40, duration: 100, percent: 0.4 }));
    expect(api.saveProgress).toHaveBeenCalledWith('l2', { videoSeconds: 40, videoDuration: 100, watchedPct: 40 });
    act(() => {
      for (let s = 41; s <= 90; s++) vimeo.handlers.timeupdate!({ seconds: s, duration: 100, percent: s / 100 });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Open the video on Vimeo/ })).toHaveAttribute('href', 'https://vimeo.com/76979871/8272103f6e');
  });
});
