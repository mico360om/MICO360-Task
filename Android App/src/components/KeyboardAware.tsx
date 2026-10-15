import React, { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Keyboard, ScrollView, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { fieldScrollDelta, type Span } from '../lib/field-scroll';

/**
 * Keeps the field being typed in — with its label, error, and the buttons that go with it when
 * they fit — above the on-screen keyboard.
 *
 * Android shrinks the window for the keyboard (adjustResize), but only nudges the text box itself
 * into view, flush against the keyboard, with its Save / Send buttons left underneath. Once the
 * keyboard is up, a `KeyboardAwareScrollView` scrolls further, by the same rules as the web app
 * (lib/field-scroll.ts). `TextField` takes part on its own; wrap a field and its buttons in a
 * `KeyboardGroup` to keep them in view together.
 */

const MARGIN = 16;

type Target = { field: React.RefObject<View>; group: React.RefObject<View> | null };
interface ScrollApi {
  reveal(target: Target): void;
  release(field: React.RefObject<View>): void;
}
const ScrollContext = createContext<ScrollApi | null>(null);
const GroupContext = createContext<React.RefObject<View> | null>(null);

type OnScreen = { top: number; height: number };
const onScreen = (ref: React.RefObject<View | ScrollView> | null) =>
  new Promise<OnScreen | null>((resolve) => {
    const node = ref?.current as View | null | undefined;
    if (!node) return resolve(null);
    node.measureInWindow((_x, y, _w, h) => resolve(h > 0 ? { top: y, height: h } : null));
  });

/** A ScrollView that keeps the focused field (and its group) above the keyboard. */
export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardAwareScrollView(
  { onScroll, onLayout, scrollEventThrottle, ...props },
  ref,
) {
  const scroll = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => scroll.current as ScrollView, []);
  const offset = useRef(0);
  const target = useRef<Target | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const run = useCallback(async () => {
    const t = target.current;
    if (!t || !Keyboard.isVisible()) return;
    const [view, field, group] = await Promise.all([onScreen(scroll), onScreen(t.field), onScreen(t.group)]);
    if (!view || !field || target.current !== t) return;
    const span = (m: OnScreen): Span => ({ top: m.top - view.top, bottom: m.top - view.top + m.height });
    // A group holds the field and its buttons: shown whole when it fits, else just the field.
    const delta = fieldScrollDelta({ visible: { top: 0, bottom: view.height }, field: span(field), actions: group ? span(group) : null, margin: MARGIN });
    if (delta) scroll.current?.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
  }, []);
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    // After Android has resized the window for the keyboard and the screen is laid out again.
    timer.current = setTimeout(() => void run(), 150);
  }, [run]);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', schedule);
    return () => {
      shown.remove();
      clearTimeout(timer.current);
    };
  }, [schedule]);

  const api = useMemo<ScrollApi>(
    () => ({
      reveal: (t) => {
        target.current = t;
        schedule();
      },
      release: (field) => {
        if (target.current?.field === field) target.current = null;
      },
    }),
    [schedule],
  );

  return (
    <ScrollContext.Provider value={api}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        {...props}
        scrollEventThrottle={scrollEventThrottle ?? 16}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
        onLayout={(e) => {
          onLayout?.(e);
          schedule(); // the window shrank for the keyboard (or grew back)
        }}
      />
    </ScrollContext.Provider>
  );
});

/** A field with the buttons that act on it (Save · Cancel, Send): kept in view together while typing. */
export function KeyboardGroup({ children, ...props }: ViewProps) {
  const ref = useRef<View>(null);
  return (
    <GroupContext.Provider value={ref}>
      <View ref={ref} collapsable={false} {...props}>
        {children}
      </View>
    </GroupContext.Provider>
  );
}

/**
 * For a text field: the ref for its container (label, box, error) and focus/blur handlers that keep
 * it above the keyboard inside a KeyboardAwareScrollView. Does nothing elsewhere.
 */
export function useKeepAboveKeyboard() {
  const api = useContext(ScrollContext);
  const group = useContext(GroupContext);
  const field = useRef<View>(null);
  return useMemo(
    () => ({
      ref: field,
      onFocus: () => api?.reveal({ field, group }),
      onBlur: () => api?.release(field),
    }),
    [api, group],
  );
}
