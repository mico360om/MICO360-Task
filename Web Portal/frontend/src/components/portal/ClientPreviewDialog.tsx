import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MemoryRouter,
  UNSAFE_DataRouterContext as DataRouterContext,
  UNSAFE_DataRouterStateContext as DataRouterStateContext,
  UNSAFE_LocationContext as LocationContext,
  UNSAFE_RouteContext as RouteContext,
} from 'react-router-dom';
import { apiClient } from '../../api/client';
import { previewPortalApi, type ClientPreviewSpec } from '../../api/portal';
import { useDialog } from '../../hooks/useDialog';
import { loadWithRecovery } from '../../lib/update-recovery';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { PortalApiProvider } from './portal-context';
import { Loading, TOUCH } from './portal-ui';

/** The portal's pages, fetched (with the rest of the portal, in its one file) only when a preview opens. */
const PortalPreviewRoutes = lazy(loadWithRecovery(() => import('../../pages/portal').then((m) => ({ default: m.PortalPreviewRoutes }))));

/** The route context at the top of a router: no parent routes (the admin's page is not the portal's parent). */
const TOP_ROUTE = { outlet: null, matches: [], isDataRoute: false };

/**
 * 1.23.7 Preview as client: the Client portal exactly as this client would see it — with the permission
 * matrix still on screen — in a full-screen dialog, read-only ("Preview — nothing you do here is saved or
 * sent"). It never signs in as the client: it reads through the administrators' preview routes, and every
 * action is shown but switched off (the preview API refuses writes before anything leaves the page).
 */
export interface ClientPreviewDialogProps {
  spec: ClientPreviewSpec;
  onClose: () => void;
}

export function ClientPreviewDialog({ spec, onClose }: ClientPreviewDialogProps) {
  const id = useId();
  // Focus goes to the dialog itself (its portal loads in after it opens); Escape closes; focus goes back on close.
  const dialogRef = useDialog(onClose, { initialFocus: 'container' });
  // A new matrix (another role, another tick) is a new preview: read again from its first page.
  const specKey = JSON.stringify(spec);

  // The page behind stays still while the preview scrolls.
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-who`}
        tabIndex={-1}
        className="above-keyboard fixed inset-0 z-50 flex flex-col bg-ground outline-none animate-fade-in"
      >
        <div className="flex flex-none items-center gap-3 border-b-2 border-brand/30 bg-surface px-4 py-2 shadow-soft sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="font-display text-base font-bold text-ink">
              Preview as client
            </h2>
            <p id={`${id}-who`} className="truncate text-xs text-ink-2">
              {whoWords(spec)}
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" className={`${TOUCH} flex-none`} onClick={onClose}>
            Close preview
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <PreviewPortal key={specKey} spec={spec} />
        </div>
      </div>
    </ModalPortal>
  );
}

/** Whose portal this is: "Huda Client · Gulf Builders", their email, or a client not saved yet. */
function whoWords(spec: ClientPreviewSpec): string {
  const name = [spec.firstName, spec.lastName].map((s) => s?.trim()).filter(Boolean).join(' ');
  const words = [name || spec.email?.trim(), spec.organisation?.trim()].filter(Boolean).join(' · ');
  return words || 'A new client (not saved yet)';
}

/**
 * The portal itself, for one matrix: its own cache (nothing it reads mixes with the administrator's pages,
 * nothing retries), the preview's API, and its own memory router — so its links move the preview only,
 * never the page behind it.
 *
 * React Router refuses a router inside another one; the dialog is rendered inside the site's own router, so
 * the inner one is given no outer location (and no outer routes, or it would match below the admin's page).
 */
function PreviewPortal({ spec }: { spec: ClientPreviewSpec }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  const [api] = useState(() => previewPortalApi(apiClient, spec));
  return (
    <QueryClientProvider client={queryClient}>
      <PortalApiProvider api={api} preview>
        <DataRouterContext.Provider value={null}>
          <DataRouterStateContext.Provider value={null}>
            <LocationContext.Provider value={null as never}>
              <RouteContext.Provider value={TOP_ROUTE}>
                <MemoryRouter initialEntries={['/portal']}>
                  <Suspense fallback={<Loading what="the preview" />}>
                    <PortalPreviewRoutes />
                  </Suspense>
                </MemoryRouter>
              </RouteContext.Provider>
            </LocationContext.Provider>
          </DataRouterStateContext.Provider>
        </DataRouterContext.Provider>
      </PortalApiProvider>
    </QueryClientProvider>
  );
}
