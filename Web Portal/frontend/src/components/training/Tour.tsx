import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { trainingApi } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { usePortalApi } from '../portal/portal-context';
import { portalKeys, usePortalTrainingSummary } from '../portal/portal-queries';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { useTourStore } from './tour-store';
import { trainingKeys, useTrainingAccess } from './training-queries';

/**
 * The first-time tour (owner answer 17): a few steps pointing at the site's main parts — 6 for staff, 3 for clients
 * in the portal. Each step points at its part (`data-tour="…"` on the element); a part that isn't on the screen (a
 * folded menu on a phone, another page) gets a card in the middle instead. Next / Back / Skip (Escape skips); focus
 * stays in the tour while it is open. Finishing or skipping it tells the server (it then never opens by itself).
 */
export interface TourStep {
  /** The `data-tour` name of the part it points at. */
  anchor: string;
  title: string;
  body: string;
}

export const STAFF_TOUR: TourStep[] = [
  { anchor: 'menu', title: 'The side menu', body: 'Every part of the site is here: your tasks, boards, projects, meetings, chat and more. On a phone, open it with the ☰ button.' },
  { anchor: 'my-tasks', title: 'My Tasks', body: 'Everything given to you, across your projects — what is due first is at the top.' },
  { anchor: 'new-task', title: 'New task', body: 'Add a task from any page. It starts in the project you are looking at.' },
  { anchor: 'board', title: 'Kanban board', body: 'A project’s tasks as cards in columns — move them along as the work moves on.' },
  { anchor: 'notifications', title: 'Notifications', body: 'Mentions, tasks given to you, reminders and answers arrive here.' },
  { anchor: 'training', title: 'Learning Hub', body: 'Short courses on each part of the site, your progress and your certificates. Take this tour again from there any time.' },
];

export const CLIENT_TOUR: TourStep[] = [
  { anchor: 'portal-projects', title: 'Your projects', body: 'The projects the team shares with you. Open one to follow its progress, tasks and meetings.' },
  { anchor: 'portal-notifications', title: 'Notifications', body: 'Replies to your comments, documents, minutes and meeting invitations from the project team.' },
  { anchor: 'portal-training', title: 'Learning Hub', body: 'Short courses on using the portal. Take this tour again from there any time.' },
];

const PANEL_W = 320;
const GAP = 12;
const EDGE = 16;

/** The first element with this `data-tour` name that is on the screen now (null: none — a folded menu, another page). */
export function findAnchor(name: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
    const r = el.getBoundingClientRect();
    if (el.getClientRects().length > 0 && r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Where the card goes beside a part: to its right (a menu), below or above it — always inside the window. */
export function placeCard(r: { top: number; left: number; right: number; bottom: number; width: number }, vw: number, vh: number, h: number): { top: number; left: number } {
  const w = Math.min(PANEL_W, vw - EDGE * 2);
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - w - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - h - EDGE));
  if (r.right + GAP + w + EDGE <= vw && r.left < vw / 3) return { top: clampY(r.top), left: r.right + GAP };
  if (r.bottom + GAP + h + EDGE <= vh) return { top: r.bottom + GAP, left: clampX(r.left + r.width / 2 - w / 2) };
  return { top: clampY(r.top - GAP - h), left: clampX(r.left + r.width / 2 - w / 2) };
}

export function TourDialog({ steps, onFinish }: { steps: TourStep[]; onFinish: (how: 'done' | 'skip') => void }) {
  const [at, setAt] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 1024, h: typeof window !== 'undefined' ? window.innerHeight : 768 });
  const [panelH, setPanelH] = useState(220);
  const ref = useDialog<HTMLDivElement>(() => onFinish('skip'), { initialFocus: 'container' });
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const step = steps[at]!;
  const last = at === steps.length - 1;

  const measure = useCallback(() => {
    const el = findAnchor(step.anchor);
    setRect(el ? el.getBoundingClientRect() : null);
    setSize({ w: window.innerWidth, h: window.innerHeight });
  }, [step.anchor]);

  // The part pointed at is brought into view (only when it isn't), then measured — and again as the window moves.
  useLayoutEffect(() => {
    const el = findAnchor(step.anchor);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView?.({ block: 'nearest' });
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, step.anchor]);

  useLayoutEffect(() => {
    if (ref.current) setPanelH(ref.current.offsetHeight || 220);
  }, [at, ref]);

  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [at]);

  const go = (to: number) => {
    moved.current = true;
    setAt(to);
  };

  const place = rect ? placeCard(rect, size.w, size.h, panelH) : null;
  // No part to point at: a card in the middle of the window.
  const width = Math.min(PANEL_W, size.w - EDGE * 2);
  const at0 = place ?? { top: Math.max(EDGE, (size.h - panelH) / 2), left: Math.max(EDGE, (size.w - width) / 2) };
  const pad = 6;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[70]" data-tour-layer>
        {rect ? (
          // The part, lit; the rest of the page dimmed around it.
          <div
            aria-hidden="true"
            data-tour-spot
            className="pointer-events-none fixed rounded-xl ring-4 ring-brand transition-all duration-200 motion-reduce:transition-none"
            style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
          />
        ) : (
          <div aria-hidden="true" className="fixed inset-0 bg-scrim animate-fade-in" />
        )}
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          tabIndex={-1}
          data-tour-card={place ? 'beside' : 'centre'}
          className="card fixed flex flex-col gap-3 p-5 shadow-lift outline-none animate-scale-in"
          style={{ width, top: at0.top, left: at0.left }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Step {at + 1} of {steps.length}
          </p>
          <h2 id="tour-title" ref={heading} tabIndex={-1} className="font-display text-lg font-bold text-ink outline-none">
            {step.title}
          </h2>
          <p id="tour-body" className="text-sm text-ink-2">
            {step.body}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="[@media(pointer:coarse)]:!min-h-11" onClick={() => onFinish('skip')}>
              Skip tour
            </Button>
            <div className="flex gap-2">
              {at > 0 ? (
                <Button variant="secondary" size="sm" className="[@media(pointer:coarse)]:!min-h-11" onClick={() => go(at - 1)}>
                  Back
                </Button>
              ) : null}
              <Button size="sm" className="[@media(pointer:coarse)]:!min-h-11" onClick={() => (last ? onFinish('done') : go(at + 1))}>
                {last ? 'Finish' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

const staffApi = trainingApi(apiClient);

/** The staff app's tour: by itself once when the server says so (a new account), and whenever "Take the tour" is pressed. */
export function StaffTour() {
  const access = useTrainingAccess();
  const qc = useQueryClient();
  const open = useTourStore((s) => s.open);
  const autoStart = useTourStore((s) => s.autoStart);
  const close = useTourStore((s) => s.close);
  const show = access.data?.tour?.show === true;
  useEffect(() => {
    if (show) autoStart();
  }, [show, autoStart]);
  if (!open) return null;
  return (
    <TourDialog
      steps={STAFF_TOUR}
      onFinish={() => {
        close();
        void staffApi
          .tourDone()
          .then(() => qc.invalidateQueries({ queryKey: trainingKeys.access }))
          .catch(() => undefined);
      }}
    />
  );
}

/** The Client portal's tour (3 steps): the same, through the portal's API. */
export function PortalTour() {
  const summary = usePortalTrainingSummary();
  const api = usePortalApi();
  const qc = useQueryClient();
  const open = useTourStore((s) => s.open);
  const autoStart = useTourStore((s) => s.autoStart);
  const close = useTourStore((s) => s.close);
  const show = summary.data?.tour?.show === true;
  useEffect(() => {
    if (show) autoStart();
  }, [show, autoStart]);
  if (!open) return null;
  return (
    <TourDialog
      steps={CLIENT_TOUR}
      onFinish={() => {
        close();
        void api
          .trainingTourDone()
          .then(() => qc.invalidateQueries({ queryKey: portalKeys.trainingSummary }))
          .catch(() => undefined);
      }}
    />
  );
}
