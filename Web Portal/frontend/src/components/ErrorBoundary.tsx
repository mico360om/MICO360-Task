import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort render-error boundary. Without one, a single throw during render (an unexpected
 * API shape, a null deref) unmounts the whole tree and white-screens the app. This keeps the
 * shell alive, explains what happened, and offers a reload.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for diagnostics; never swallow silently.
    console.error('Unhandled render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
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
