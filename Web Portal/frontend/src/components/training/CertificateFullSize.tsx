import { useEffect } from 'react';
import type { CertificateRef } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { CertificatePaper } from './CertificatePaper';
import { TOUCH_MIN } from './training-ui';

/**
 * The certificate full size (owner, 14 Nov: "tap to enlarge" for phones and small screens): a full-screen window with the
 * certificate at a readable width — at least 56rem (on a phone it scrolls sideways), at most as tall as the window on a
 * desktop — and pinch-zoom left on. Close at the top, Esc closes too, and focus goes back to the certificate (the
 * caller's onClose). The scrolling area is a named, focusable region, so a keyboard can scroll it; the page behind stays
 * still while it is open.
 */
export function CertificateFullSize({ certificate, onClose }: { certificate: CertificateRef; onClose: () => void }) {
  const dialogRef = useDialog(onClose);

  useEffect(() => {
    const { body } = document;
    const before = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = before;
    };
  }, []);

  return (
    <ModalPortal>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Certificate, full size" className="above-keyboard fixed inset-0 z-[60] flex animate-fade-in flex-col bg-ground">
        <div className="flex flex-none items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
          <h2 className="min-w-0 truncate font-display text-base font-bold text-ink">Certificate</h2>
          <Button variant="secondary" className={TOUCH_MIN} onClick={onClose}>
            Close
          </Button>
        </div>
        <div
          data-certificate-zoom
          role="region"
          aria-label="The certificate (scroll to see all of it)"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 sm:p-6"
        >
          <div data-certificate-zoom-paper className="mx-auto w-full" style={{ minWidth: '56rem', maxWidth: 'min(75rem, calc((100dvh - 7rem) * 1.4143))' }}>
            <CertificatePaper certificate={certificate} />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
