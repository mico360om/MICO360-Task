import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// Minimal React Native stand-in: host components are plain strings, as in the real renderer.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(s: T) => s },
  Appearance: { getColorScheme: () => 'dark' },
}));

const { ErrorBoundary } = await import('./ErrorBoundary');

type AnyElement = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;

/** Every element type in a rendered tree (without mounting anything). */
function elementTypes(node: React.ReactNode, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const n of node) elementTypes(n, out);
  } else if (React.isValidElement(node)) {
    const el = node as AnyElement;
    out.push(el.type);
    elementTypes(el.props.children, out);
  }
  return out;
}

function findByType(node: React.ReactNode, type: string): AnyElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findByType(n, type);
      if (hit) return hit;
    }
  } else if (React.isValidElement(node)) {
    const el = node as AnyElement;
    if (el.type === type) return el;
    return findByType(el.props.children, type);
  }
  return null;
}

function boundaryWithError() {
  const reporter = { captureException: vi.fn() };
  const eb = new ErrorBoundary({ reporter, children: 'child' });
  eb.state = { error: new Error('bad API value') };
  return { eb, reporter };
}

describe('ErrorBoundary fallback (MOB-02)', () => {
  it('renders only plain React Native primitives — no themed components that need a provider', () => {
    const { eb } = boundaryWithError();
    const types = elementTypes(eb.render());
    expect(types.length).toBeGreaterThan(0);
    // A function/class component here (Button, Heading, …) would call useTheme() and crash
    // because this boundary sits outside ThemeProvider.
    expect(types.every((t) => typeof t === 'string')).toBe(true);
    expect(types).toContain('Pressable');
  });

  it('offers "Try again", which clears the error', () => {
    const { eb } = boundaryWithError();
    const setState = vi.spyOn(eb, 'setState').mockImplementation(() => {});
    const button = findByType(eb.render(), 'Pressable');
    expect(button?.props.accessibilityLabel).toBe('Try again');
    (button!.props.onPress as () => void)();
    expect(setState).toHaveBeenCalledWith({ error: null });
  });

  it('renders children when there is no error', () => {
    const eb = new ErrorBoundary({ reporter: { captureException: vi.fn() }, children: 'child' });
    expect(eb.render()).toBe('child');
  });

  it('reports the crash, and a failing reporter cannot break the fallback', () => {
    const { eb, reporter } = boundaryWithError();
    eb.componentDidCatch(new Error('x'), { componentStack: 'stack' } as React.ErrorInfo);
    expect(reporter.captureException).toHaveBeenCalledWith(expect.any(Error), { componentStack: 'stack' });

    const broken = new ErrorBoundary({
      reporter: {
        captureException: () => {
          throw new Error('reporter down');
        },
      },
      children: null,
    });
    expect(() => broken.componentDidCatch(new Error('x'), { componentStack: '' } as React.ErrorInfo)).not.toThrow();
  });

  it('derives the error state', () => {
    const err = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });
});
