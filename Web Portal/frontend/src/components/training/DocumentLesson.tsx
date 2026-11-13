import { useState } from 'react';
import type { LessonDone, LessonView } from '../../api/training';
import { STATUS_CLASS } from '../../lib/colour-classes';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Button } from '../ui/Button';
import type { LessonNext } from './GuideLesson';
import { LessonFooter } from './LessonFooter';
import { useLearner } from './learner';
import { DownloadIcon, TOUCH_MIN, TickIcon, sizeText, trainingProblem, useBlobUrl } from './training-ui';

/** A phone (or a narrow window): the PDF opens full screen instead of inside the page (design call 6). */
export const PHONE_QUERY = '(pointer: coarse), (max-width: 47.99em)';

/**
 * A document lesson: a PDF shown in the page on a desktop; on a phone "Open full screen" and "Download" instead
 * (a small frame is no way to read it there). Other files are a download. The lesson's one Next ("Next lesson",
 * "Finish course") marks it read and goes on (12 Nov §4); it sits in the lesson's footer bar with "Previous lesson"
 * and "Read" (13 Nov new look). Open full screen and Download stay with the document.
 */
export function DocumentLesson({ lesson, onDone, next }: { lesson: LessonView; onDone: (done: LessonDone) => void; next: LessonNext }) {
  const { api } = useLearner();
  const doc = lesson.document;
  const phone = useMediaQuery(PHONE_QUERY);
  const pdf = doc?.mimeType === 'application/pdf';
  const inline = useBlobUrl((id) => api.file(id).then((b) => new Blob([b], { type: 'application/pdf' })), pdf && !phone ? doc?.id : null);
  const [done, setDone] = useState(lesson.progress.done);
  const [busy, setBusy] = useState<'done' | 'open' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!doc) {
    return (
      <div className="flex flex-col gap-3">
        <div className="card card-pad">
          <p className="text-sm text-ink-2">This lesson’s document isn’t attached yet.</p>
        </div>
        <LessonFooter lesson={lesson} />
      </div>
    );
  }

  const download = async () => {
    setBusy('download');
    setError(null);
    try {
      const blob = await api.file(doc.id);
      downloadBlob(fileNameOf(blob) ?? doc.name, blob);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t download the document.'));
    } finally {
      setBusy(null);
    }
  };

  // A window opened at once (a phone's browser would block one opened after the download), then given the file.
  const openFull = async () => {
    const win = window.open('', '_blank');
    setBusy('open');
    setError(null);
    try {
      const blob = await api.file(doc.id);
      const url = URL.createObjectURL(new Blob([blob], { type: doc.mimeType }));
      if (win) win.location.href = url;
      else downloadBlob(doc.name, blob);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      setError(trainingProblem(err, 'Couldn’t open the document.'));
    } finally {
      setBusy(null);
    }
  };

  const finish = async () => {
    if (done) {
      next.go(null);
      return;
    }
    setBusy('done');
    setError(null);
    try {
      const out = await api.complete(lesson.id);
      setDone(true);
      onDone(out);
      next.go(out);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t finish this lesson.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {pdf && !phone ? (
        inline.failed ? (
          <p role="alert" className="card card-pad text-sm text-danger">The document couldn’t load. Download it instead.</p>
        ) : inline.url ? (
          <iframe src={inline.url} title={doc.name} className="h-[75vh] min-h-[24rem] w-full rounded-xl border border-line bg-surface" />
        ) : (
          <p role="status" className="card card-pad text-center text-sm text-ink-2">
            <span className="animate-pulse motion-reduce:animate-none">Loading the document…</span>
          </p>
        )
      ) : (
        <div className="card card-pad flex flex-col gap-1">
          <p className="break-words font-semibold text-ink">{doc.name}</p>
          <p className="text-xs text-ink-2">{sizeText(doc.sizeBytes)}</p>
          <p className="mt-1 text-sm text-ink-2">{pdf ? 'Open it full screen to read it, or download it.' : 'Download it and open it on your device.'}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {pdf && phone ? (
          <Button variant="secondary" className={TOUCH_MIN} loading={busy === 'open'} onClick={() => void openFull()}>
            Open full screen
          </Button>
        ) : null}
        <Button variant="secondary" className={TOUCH_MIN} loading={busy === 'download'} onClick={() => void download()}>
          <DownloadIcon />
          Download
        </Button>
      </div>
      <LessonFooter
        lesson={lesson}
        status={
          done ? (
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${STATUS_CLASS.DONE.text}`}>
              <TickIcon />
              Read
            </span>
          ) : null
        }
        next={
          <Button className={TOUCH_MIN} loading={busy === 'done'} onClick={() => void finish()}>
            {next.label}
          </Button>
        }
      />
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
