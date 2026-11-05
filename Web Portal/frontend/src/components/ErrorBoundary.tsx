import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportPageError } from '../lib/error-reporting';
import { isChunkFailure, recoverChunk } from '../lib/update-recovery';

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
  /** 1.23.2: the site's code didn't load — looking for a newer build, reloading to it, or it didn't help. */
  chunk?: 'checking' | 'reloading' | 'failed';
}

/**
 * Last-resort render-error boundary. Without one, a single throw during render (an unexpected
 * API shape, a null deref) unmounts the whole tree and white-screens the app. This keeps the
 * shell alive, explains what happened, and offers a reload.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, chunk: isChunkFailure(error) ? 'checking' : undefined };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for diagnostics; never swallow silently.
    console.error('Unhandled render error', error, info.componentStack);
    // 1.23.2: the site's code didn't load (an update replaced it): a newer build → the page reloads to
    // it and nothing is recorded; otherwise the plain message, and it goes to the Error log.
    if (isChunkFailure(error)) {
      void recoverChunk().then((r) => {
        this.setState({ chunk: r });
        if (r === 'failed') reportPageError(error);
      });
      return;
    }
    // 1.22.4: and to the Error log (System Settings → Error log), with the site's own file and line.
    reportPageError(error);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.state.chunk === 'checking' || this.state.chunk === 'reloading') {
      return (
        <div role="status" className="grid min-h-screen place-items-center bg-ground p-6 text-sm text-ink-2">
          {this.state.chunk === 'reloading' ? 'Loading the new version…' : 'Loading this page…'}
        </div>
      );
    }
    if (this.state.chunk === 'failed') {
      return (
        <div role="alert" className="grid min-h-screen place-items-center bg-ground p-6">
          <div className="card max-w-md p-6 text-center">
            <h1 className="font-display text-xl font-bold text-ink">This page couldn’t load — check your connection and try again</h1>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-2 [@media(pointer:coarse)]:!min-h-11"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return (
      <div role="alert" className="grid min-h-screen place-items-center bg-ground p-6">
        <div className="card max-w-md p-6 text-center">
          <p className="eyebrow">Something went wrong</p>
          <h1 className="mt-2 font-display text-xl font-bold text-ink">This page hit an unexpected error</h1>
          <p className="mt-2 text-sm text-ink-2">Your work is saved on the server. Reload to pick up where you left off.</p>
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-left font-mono text-xs text-danger">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-2"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
