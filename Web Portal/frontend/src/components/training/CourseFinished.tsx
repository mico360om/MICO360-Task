import { useEffect, useRef, useState } from 'react';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { Button } from '../ui/Button';
import { useLearner } from './learner';
import { AwardIcon, TOUCH_MIN, trainingProblem } from './training-ui';

/**
 * The course is finished (12 Nov §4, §5): said once, plainly, with the certificate to download when there is one.
 * The heading takes the focus (a screen reader hears it). The way on is the lesson's one Next, given by the caller.
 */
export function CourseFinished({ title, certificateId, focus = true }: { title: string; certificateId: string | null; focus?: boolean }) {
  const side = useLearner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  const download = async () => {
    if (!certificateId) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await side.api.certificatePdf(certificateId);
      downloadBlob(fileNameOf(blob) ?? 'certificate.pdf', blob);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t download the certificate.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="course-finished" data-course-finished className="card card-pad flex flex-col items-center gap-3 border-2 border-success/40 bg-success-soft/30 py-6 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-success-soft text-success">
        <AwardIcon size={24} />
      </span>
      <h2 id="course-finished" ref={heading} tabIndex={-1} className="font-display text-xl font-bold text-ink outline-none">
        Course completed
      </h2>
      <p className="max-w-md text-sm text-ink-2">
        Well done — you finished <span className="font-semibold text-ink">{title}</span>.{certificateId ? ' Your certificate is ready.' : ''}
      </p>
      {certificateId ? (
        <Button className={TOUCH_MIN} loading={busy} onClick={() => void download()}>
          Download certificate (PDF)
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
