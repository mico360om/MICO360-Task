import { useState } from 'react';
import { LIMITS, type FileRef, type ManageCourse } from '../../../api/training';
import { downloadBlob } from '../../../lib/download';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Glyph, Notice, SectionCard, problemText, sizeText } from './manage-ui';
import { tc, useCourseCache } from './manage-queries';
import { DOCUMENT_TYPES, FilePickButton, UploadProgress, useUpload } from './uploads';

/** Downloads: files learners can save from the course page (up to 25 MB each) — upload, download, remove. */
export function DownloadsSection({ course }: { course: ManageCourse }) {
  const cache = useCourseCache(course.id);
  const up = useUpload();
  const [removing, setRemoving] = useState<FileRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(file: File) {
    const ref = await up.run(file, LIMITS.documentBytes, (onProgress) => tc().uploadFile(course.id, 'RESOURCE', file, onProgress));
    if (ref) cache.refresh();
  }
  async function remove(f: FileRef) {
    setBusy(true);
    setRemoveProblem(null);
    try {
      await tc().deleteFile(f.id);
      setRemoving(null);
      cache.refresh();
    } catch (err) {
      setRemoveProblem(`Couldn’t remove it. ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }
  async function download(f: FileRef) {
    setProblem(null);
    try {
      downloadBlob(f.name, await tc().file(f.id));
    } catch (err) {
      setProblem(`Couldn’t download “${f.name}”. ${problemText(err)}`);
    }
  }

  return (
    <SectionCard
      id="tc-ed-downloads"
      title="Downloads"
      description="Files learners can save from the course page: a printable guide, a checklist, a template. Up to 25 MB each."
      actions={<FilePickButton label="Upload a file" accept={DOCUMENT_TYPES} disabled={up.busy} onPick={(f) => void pick(f)} />}
    >
      <div className="flex flex-col gap-2">
        <UploadProgress progress={up.progress} />
        {up.problem ? <Notice>{up.problem}</Notice> : null}
        {problem ? <Notice>{problem}</Notice> : null}
        {course.resources.length === 0 ? (
          <p className="text-sm text-ink-2">No downloads.</p>
        ) : (
          <ul aria-label="Downloads" className="divide-y divide-line rounded-lg border border-line">
            {course.resources.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="text-ink-2" aria-hidden="true">{Glyph.document}</span>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{f.name}</p>
                  <p className="text-xs text-ink-2">{sizeText(f.sizeBytes)}</p>
                </div>
                <Button variant="ghost" size="sm" aria-label={`Download ${f.name}`} onClick={() => void download(f)} className="[@media(pointer:coarse)]:!min-h-11">
                  {Glyph.download}
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => {
                    setRemoveProblem(null);
                    setRemoving(f);
                  }}
                  className="[@media(pointer:coarse)]:!min-h-11"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {removing ? (
        <ConfirmDialog title={`Remove “${removing.name}”?`} confirmLabel="Remove file" busy={busy} error={removeProblem} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
          Learners can no longer download it. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </SectionCard>
  );
}
