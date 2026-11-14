import { useId } from 'react';
import type { CertificateRef } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { CertificatePaper } from './CertificatePaper';
import { TOUCH_MIN } from './training-ui';

/**
 * The certificate full size (owner, 14 Nov: "tap to enlarge" for phones and small screens): a full-screen window with the
 * certificate at a readable width (at least 56rem, so on a phone it scrolls sideways; pinch-zoom allowed), Close at the
 * top, Esc closes too, and focus goes back to the certificate (the caller's onClose).
 */
export function CertificateFullSize({ certificate, onClose }: { certificate: CertificateRef; onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  const id = useId();
  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-[60] flex">
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Certificate, full size" className="relative flex h-full w-full flex-col bg-ground/95">
          <div className="flex flex-none items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
            <h2 id={`${id}-title`} className="min-w-0 truncate font-display text-base font-bold text-ink">
              Certificate
            </h2>
            <Button variant="secondary" className={TOUCH_MIN} onClick={onClose}>
              Close
            </Button>
          </div>
          <div data-certificate-zoom className="min-h-0 flex-1 overflow-auto p-3 sm:p-6" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
            <div data-certificate-zoom-paper className="mx-auto w-full" style={{ minWidth: '56rem', maxWidth: '75rem' }}>
              <CertificatePaper certificate={certificate} />
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
