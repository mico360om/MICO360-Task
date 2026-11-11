import { useEffect, useId, useRef, useState } from 'react';
import Player from '@vimeo/player';
import type { LessonDone, LessonView } from '../../api/training';
import { Button } from '../ui/Button';
import { useLearner } from './learner';
import { TOUCH_MIN, TickIcon, trainingProblem } from './training-ui';
import { WatchTracker, YOUTUBE_ORIGIN, YT_ENDED, readYouTubeMessage, vimeoSrc, youtubeListening, youtubeSubscribe, youtubeSrc } from './video-watch';

/** How often the position is saved while the video plays. */
export const SAVE_EVERY_MS = 5_000;
/** How often the page says "listening" to YouTube's frame until it answers (its player may load after the frame). */
const LISTEN_EVERY_MS = 500;
const LISTEN_TRIES = 40;

/**
 * A video lesson: the YouTube or Vimeo player inside the lesson, its position saved every few seconds and
 * resumed next time, done at 90 % watched. When the player's events never arrive (blocked, an old browser),
 * "Mark as watched" appears after the lesson's minimum time; the link to open the video outside is always there.
 */
export function VideoLesson({ lesson, onDone }: { lesson: LessonView; onDone: (done: LessonDone) => void }) {
  const { api } = useLearner();
  const video = lesson.video;
  const frame = useRef<HTMLIFrameElement>(null);
  const frameId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [heard, setHeard] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [pct, setPct] = useState(lesson.progress.watchedPct);
  const [done, setDone] = useState(lesson.progress.done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracker = useRef(new WatchTracker(lesson.progress.watchedPct, lesson.progress.videoSeconds));
  const doneRef = useRef(lesson.progress.done);
  const lastSaved = useRef(0);
  const completing = useRef(false);
  // A finished lesson watched again starts at the beginning; an unfinished one where it stopped.
  const resumeAt = lesson.progress.done ? 0 : lesson.progress.videoSeconds;

  const complete = async () => {
    if (doneRef.current || completing.current) return;
    completing.current = true;
    setBusy(true);
    setError(null);
    try {
      const out = await api.complete(lesson.id);
      doneRef.current = true;
      setDone(true);
      onDone(out);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t mark this lesson as watched.'));
    } finally {
      completing.current = false;
      setBusy(false);
    }
  };
  const completeRef = useRef(complete);
  completeRef.current = complete;

  const save = (force = false) => {
    const body = tracker.current.save();
    if (!body) return;
    const now = Date.now();
    if (!force && now - lastSaved.current < SAVE_EVERY_MS) return;
    lastSaved.current = now;
    void api.saveProgress(lesson.id, body).catch(() => undefined);
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /** A time report from either player. */
  const report = (current: number | undefined, duration?: number) => {
    setHeard(true);
    tracker.current.update(current, duration);
    setPct(tracker.current.pct);
    saveRef.current();
    if (tracker.current.watchedEnough && !doneRef.current) {
      saveRef.current(true);
      void completeRef.current();
    }
  };
  const reportRef = useRef(report);
  reportRef.current = report;

  // YouTube: say "listening" until the frame answers, then read its messages (from YouTube, from this frame only).
  useEffect(() => {
    if (video?.provider !== 'YOUTUBE') return;
    const target = new URL(video.embedUrl).origin;
    let answered = false;
    let tries = 0;
    const say = () => {
      const win = frame.current?.contentWindow;
      if (!win) return;
      try {
        win.postMessage(youtubeListening(frameId), target);
        win.postMessage(youtubeSubscribe(frameId, 'onStateChange'), target);
      } catch {
        /* the frame isn't there yet */
      }
    };
    const timer = window.setInterval(() => {
      if (answered || ++tries > LISTEN_TRIES) return window.clearInterval(timer);
      say();
    }, LISTEN_EVERY_MS);
    say();
    const onMessage = (e: MessageEvent) => {
      // Review M14: YouTube's origin AND this lesson's own frame (never another window, never no window).
      const own = frame.current?.contentWindow;
      if (!YOUTUBE_ORIGIN.test(e.origin) || !own || e.source !== own) return;
      const m = readYouTubeMessage(e.data);
      if (!m) return;
      answered = true;
      if (m.kind === 'info') {
        reportRef.current(m.currentTime, m.duration);
        if (m.state === YT_ENDED) saveRef.current(true);
      } else if (m.kind === 'state') {
        setHeard(true);
        if (m.state === YT_ENDED || m.state === 2) saveRef.current(true);
      } else {
        setHeard(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
      saveRef.current(true);
    };
  }, [video?.provider, video?.embedUrl, frameId]);

  // Vimeo: the official player on the frame (bundled; no script from Vimeo's site).
  useEffect(() => {
    if (video?.provider !== 'VIMEO' || !frame.current) return;
    let player: Player | null = null;
    try {
      player = new Player(frame.current);
    } catch {
      return;
    }
    const onTime = (d: { seconds: number; duration: number }) => reportRef.current(d.seconds, d.duration);
    const onPause = () => saveRef.current(true);
    player.on('timeupdate', onTime);
    player.on('pause', onPause);
    player.on('ended', onPause);
    if (resumeAt >= 5) {
      player
        .ready()
        .then(() => player?.setCurrentTime(resumeAt))
        .catch(() => undefined);
    }
    return () => {
      // Not destroy(): that takes the frame out of the page under React.
      player?.off('timeupdate', onTime);
      player?.off('pause', onPause);
      player?.off('ended', onPause);
      saveRef.current(true);
    };
    // The video decides; the resume point is read once for this lesson view.
  }, [video?.provider, video?.embedUrl]);

  // No events from the player after the lesson's minimum time: "Mark as watched".
  const hasVideo = Boolean(video);
  useEffect(() => {
    if (!hasVideo || done) return;
    const t = window.setTimeout(() => setFallback(true), Math.max(0, lesson.watchFallbackSeconds) * 1000);
    return () => window.clearTimeout(t);
  }, [hasVideo, done, lesson.watchFallbackSeconds]);

  if (!video) {
    return (
      <div className="card card-pad flex flex-col items-center gap-2 py-10 text-center">
        <p className="font-semibold text-ink">Video coming soon</p>
        <p className="max-w-md text-sm text-ink-2">The training team is adding this video. You can go on to the next lesson meanwhile.</p>
      </div>
    );
  }

  const site = video.provider === 'YOUTUBE' ? 'YouTube' : 'Vimeo';
  const src = video.provider === 'YOUTUBE' ? youtubeSrc(video.embedUrl, window.location.origin, resumeAt) : vimeoSrc(video.embedUrl);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full overflow-hidden rounded-xl border border-line bg-black pt-[56.25%]">
        <iframe
          ref={frame}
          data-video-frame={video.provider}
          src={src}
          title={`Video: ${lesson.title}`}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          {done ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-success">
              <TickIcon />
              Watched
            </span>
          ) : heard ? (
            `Watched ${pct}% — the lesson is done at 90%.`
          ) : (
            'Your place is saved as you watch.'
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!done && fallback && !heard ? (
            <Button variant="secondary" size="sm" className={TOUCH_MIN} loading={busy} onClick={() => void complete()}>
              Mark as watched
            </Button>
          ) : null}
          <a href={video.watchUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center text-sm font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_MIN}`}>
            Open the video on {site}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
