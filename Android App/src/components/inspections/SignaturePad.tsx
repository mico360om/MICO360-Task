import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Image, PanResponder, PixelRatio, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { useColors } from '../../core/theme';
import { INSPECTION_LIMITS } from '../../lib/inspection-rules';
import { LINE_WIDTH, SIGN_WORDS, appendPoint, exportSize, hasInk, inkPathD, pathOf, pngDataUrl, toPadPoint, type SignatureValue, type Stroke } from '../../lib/signature-ink';
import { SIGNATURE_COLORS, radius, spacing } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { Button, TextField, Toggle } from '../ui';

/** The pad's height (dp), as the website's h-44. */
const PAD_HEIGHT = 176;
/** A moment for the drawing to reach the screen before its picture is taken. */
const EXPORT_WAIT_MS = 120;

const sameValue = (a: SignatureValue | null, b: SignatureValue | null) => a === b || (!!a && !!b && a.method === b.method && a.name === b.name && a.image === b.image);

/** The strokes drawn at a size: paths, and dots as circles. */
function Ink({ strokes, width, height, lineWidth }: { strokes: ReadonlyArray<Stroke>; width: number; height: number; lineWidth: number }) {
  return (
    <>
      {strokes.map((s, i) => {
        const path = pathOf(s.points, width, height);
        if (!path) return null;
        if (path.kind === 'dot') return <Circle key={i} cx={path.x} cy={path.y} r={lineWidth / 2} fill={SIGNATURE_COLORS.ink} />;
        return <Path key={i} d={inkPathD(path)} stroke={SIGNATURE_COLORS.ink} strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
      })}
    </>
  );
}

/**
 * A signature, drawn with a finger (only the first finger draws; the sheet doesn't scroll while
 * signing), or — for anyone who can't draw, and TalkBack users — the typed name itself ("Type my
 * name instead"), as the website's pad. The signer's typed name always goes with it. The pad is
 * white paper with dark ink in either theme; the drawing is kept as strokes (fractions of the pad),
 * so it is redrawn when the pad changes size (the phone turned on its side), and handed on as a
 * small PNG on white (at most 600×200) drawn by a second, hidden picture without the guide line.
 */
export function SignaturePad({
  label,
  defaultName = '',
  required = false,
  value,
  onChange,
  disabled = false,
  error,
  onSigning,
}: {
  /** "Inspector signature" — the visible label, and the drawing area's name. */
  label: string;
  defaultName?: string;
  required?: boolean;
  value: SignatureValue | null;
  /** Called with each drawn picture, each name change, Clear and Undo; null when nothing usable is left. */
  onChange: (value: SignatureValue | null) => void;
  disabled?: boolean;
  error?: string | null;
  /** A stroke has started (true) or ended (false): the sheet stops scrolling meanwhile. */
  onSigning?: (signing: boolean) => void;
}) {
  const c = useColors();
  const [layout, setLayout] = useState({ width: 0, height: PAD_HEIGHT });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const active = useRef<{ id: string; stroke: Stroke } | null>(null);
  const [typed, setTyped] = useState(value?.method === 'TYPED');
  const [name, setName] = useState(value?.name ?? defaultName);
  const nameRef = useRef(name);
  nameRef.current = name;
  // A drawn signature handed in from outside: shown until it is cleared or drawn over.
  const [restored, setRestored] = useState<string | null>(value?.method === 'DRAWN' ? value.image : null);
  const image = useRef<string | null>(null);
  const exportRef = useRef<Svg>(null);
  const exportSeq = useRef(0);
  const lastGiven = useRef<SignatureValue | null>(value);
  const drawable = !disabled && !typed;
  const drawableRef = useRef(drawable);
  drawableRef.current = drawable;
  const restoredRef = useRef(restored);
  restoredRef.current = restored;
  const onSigningRef = useRef(onSigning);
  onSigningRef.current = onSigning;

  const give = (next: SignatureValue | null) => {
    lastGiven.current = next;
    onChange(next);
  };
  const drawnValue = (signer: string, picture: string | null = image.current ?? restoredRef.current): SignatureValue | null =>
    picture ? { method: 'DRAWN', name: signer.trim(), image: picture } : null;
  const typedValue = (signer: string): SignatureValue | null => (signer.trim() ? { method: 'TYPED', name: signer.trim(), image: null } : null);
  const giveRef = useRef({ give, drawnValue });
  giveRef.current = { give, drawnValue };

  /** The strokes as they are now, as a PNG on white (a moment later: once they are drawn). */
  const exportNow = (list: Stroke[]) => {
    const mine = ++exportSeq.current;
    image.current = null;
    if (!hasInk(list)) return;
    setTimeout(() => {
      const svg = exportRef.current;
      if (!svg || mine !== exportSeq.current) return;
      svg.toDataURL((b64: string) => {
        if (mine !== exportSeq.current) return;
        image.current = pngDataUrl(b64);
        giveRef.current.give(giveRef.current.drawnValue(nameRef.current, image.current));
      }, exportSize(layoutRef.current.width, layoutRef.current.height));
    }, EXPORT_WAIT_MS);
  };
  const exportRefFn = useRef(exportNow);
  exportRefFn.current = exportNow;

  // The sheet emptied (or replaced) the signature: follow it.
  useEffect(() => {
    if (sameValue(value, lastGiven.current)) return;
    lastGiven.current = value;
    strokesRef.current = [];
    active.current = null;
    image.current = null;
    exportSeq.current += 1;
    setStrokes([]);
    setCurrent(null);
    setRestored(value?.method === 'DRAWN' ? value.image : null);
    if (value) {
      setTyped(value.method === 'TYPED');
      setName(value.name);
    }
  }, [value]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawableRef.current,
        onMoveShouldSetPanResponder: () => drawableRef.current,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (e) => {
          if (active.current) return; // only the first finger draws
          const { locationX, locationY, identifier } = e.nativeEvent;
          const { width, height } = layoutRef.current;
          // Drawing over a signature handed in from outside starts a new one.
          if (restoredRef.current) setRestored(null);
          const stroke: Stroke = { points: [toPadPoint(locationX, locationY, { left: 0, top: 0, width, height })] };
          active.current = { id: String(identifier), stroke };
          setCurrent(stroke);
          onSigningRef.current?.(true);
        },
        onPanResponderMove: (e) => {
          const a = active.current;
          if (!a) return;
          const touch = e.nativeEvent.touches.find((t) => String(t.identifier) === a.id) ?? (e.nativeEvent.touches.length <= 1 ? e.nativeEvent : null);
          if (!touch) return;
          const { width, height } = layoutRef.current;
          const points = appendPoint(a.stroke.points, toPadPoint(touch.locationX, touch.locationY, { left: 0, top: 0, width, height }), { width, height });
          if (points === a.stroke.points) return;
          a.stroke = { points };
          setCurrent(a.stroke);
        },
        onPanResponderRelease: () => endStroke(),
        onPanResponderTerminate: () => endStroke(),
      }),
    // The handlers read refs; one responder for the pad's life.
    [],
  );

  /** The stroke is done (lifted, or taken away): keep it, and hand the picture on. */
  function endStroke() {
    const a = active.current;
    if (!a) return;
    active.current = null;
    const wasEmpty = !hasInk(strokesRef.current);
    const next = [...strokesRef.current, a.stroke];
    strokesRef.current = next;
    setStrokes(next);
    setCurrent(null);
    onSigningRef.current?.(false);
    if (wasEmpty) AccessibilityInfo.announceForAccessibility(SIGN_WORDS.drawn);
    exportRefFn.current(next);
  }

  function clear() {
    strokesRef.current = [];
    setStrokes([]);
    setRestored(null);
    exportNow([]);
    AccessibilityInfo.announceForAccessibility(SIGN_WORDS.cleared);
    give(null);
  }

  function undo() {
    if (!hasInk(strokesRef.current)) return clear();
    const next = strokesRef.current.slice(0, -1);
    if (!hasInk(next)) return clear();
    strokesRef.current = next;
    setStrokes(next);
    AccessibilityInfo.announceForAccessibility(SIGN_WORDS.undone);
    exportNow(next);
  }

  function onTypedChange(next: boolean) {
    setTyped(next);
    if (next) {
      AccessibilityInfo.announceForAccessibility(SIGN_WORDS.typing);
      give(typedValue(name));
    } else {
      AccessibilityInfo.announceForAccessibility(hasInk(strokesRef.current) || restored ? SIGN_WORDS.drawing : SIGN_WORDS.drawIt);
      give(drawnValue(name));
    }
  }

  function onNameChange(next: string) {
    setName(next);
    give(typed ? typedValue(next) : drawnValue(next));
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== layout.width || height !== layout.height) setLayout({ width, height });
  };

  const { width, height } = layout;
  const shown = current ? [...strokes, current] : strokes;
  const hasDrawing = strokes.length > 0 || !!restored;
  const signer = name.trim();
  // The hidden picture is the stored PNG's size in pixels (dp × the screen's density = its pixels).
  const out = exportSize(width, height);
  const density = PixelRatio.get() || 1;
  const outLine = Math.max(1.5, LINE_WIDTH * (width > 0 ? out.width / width : 1));
  const guideY = height - 36;

  return (
    <View accessibilityRole="none">
      <Text style={[typeStyle('label'), { color: c.ink }]}>
        {label}
        {required ? <Text style={{ color: c.dangerText }}> *</Text> : null}
      </Text>
      <View style={[s.pad, { borderColor: error ? c.danger : c.line, backgroundColor: SIGNATURE_COLORS.paper }, disabled && s.dim]} onLayout={onLayout}>
        {/* The stored picture: paper and strokes only, under the pad (drawn, so it can be taken). */}
        {width > 0 ? (
          <Svg ref={exportRef} width={out.width / density} height={out.height / density} viewBox={`0 0 ${out.width} ${out.height}`} style={s.export}>
            <Rect x={0} y={0} width={out.width} height={out.height} fill={SIGNATURE_COLORS.paper} />
            <Ink strokes={strokes} width={out.width} height={out.height} lineWidth={outLine} />
          </Svg>
        ) : null}
        {width > 0 ? (
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Rect x={0} y={0} width={width} height={height} fill={SIGNATURE_COLORS.paper} />
            {/* The guide: a line to sign on and its cross (never in the picture). */}
            <Line x1={20} y1={guideY} x2={width - 20} y2={guideY} stroke={SIGNATURE_COLORS.guide} strokeWidth={1} strokeDasharray="4 4" />
            <Line x1={20} y1={guideY - 14} x2={30} y2={guideY - 4} stroke={SIGNATURE_COLORS.guide} strokeWidth={1.5} />
            <Line x1={30} y1={guideY - 14} x2={20} y2={guideY - 4} stroke={SIGNATURE_COLORS.guide} strokeWidth={1.5} />
            {!typed ? <Ink strokes={shown} width={width} height={height} lineWidth={LINE_WIDTH} /> : null}
          </Svg>
        ) : null}
        {restored && !typed ? <Image source={{ uri: restored }} resizeMode="contain" style={StyleSheet.absoluteFill} importantForAccessibility="no" /> : null}
        {!hasDrawing && !typed && !current ? (
          <Text style={[typeStyle('body'), s.signHere, { color: SIGNATURE_COLORS.hint }]} importantForAccessibility="no">
            {SIGN_WORDS.signHere}
          </Text>
        ) : null}
        {typed ? (
          <View style={[StyleSheet.absoluteFill, s.typed, { backgroundColor: SIGNATURE_COLORS.paper }]} accessible accessibilityRole="image" accessibilityLabel={SIGN_WORDS.typedArea.replace('{label}', label).replace('{name}', signer || SIGN_WORDS.notTyped)}>
            <Text style={[s.typedName, { color: SIGNATURE_COLORS.ink }]} numberOfLines={1}>
              {signer}
            </Text>
          </View>
        ) : (
          <View
            style={StyleSheet.absoluteFill}
            {...responder.panHandlers}
            accessible
            accessibilityRole="image"
            accessibilityLabel={SIGN_WORDS.drawingArea.replace('{label}', label)}
            accessibilityHint={SIGN_WORDS.hint}
          />
        )}
      </View>
      <Text style={[typeStyle('caption'), s.hint, { color: c.ink2 }]}>{SIGN_WORDS.hint}</Text>
      <View style={s.tools}>
        <Button title={SIGN_WORDS.undo} variant="secondary" size="sm" onPress={undo} disabled={disabled || typed || strokes.length === 0} />
        <Button title={SIGN_WORDS.clear} variant="secondary" size="sm" onPress={clear} disabled={disabled || typed || !hasDrawing} />
      </View>
      <Toggle on={typed} onChange={onTypedChange} label={SIGN_WORDS.typeInstead} disabled={disabled} />
      <TextField label={SIGN_WORDS.signerName} required value={name} onChangeText={onNameChange} autoComplete="name" maxLength={INSPECTION_LIMITS.signerNameMax} editable={!disabled} error={error && !signer ? error : null} />
      {error && signer ? (
        <Text style={[typeStyle('caption'), { color: c.dangerText }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  pad: { height: PAD_HEIGHT, marginTop: 6, borderWidth: 1, borderRadius: radius.button, overflow: 'hidden' },
  dim: { opacity: 0.6 },
  export: { position: 'absolute', left: 0, top: 0 },
  signHere: { position: 'absolute', left: 0, right: 0, top: PAD_HEIGHT / 3, textAlign: 'center' },
  typed: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  typedName: { fontSize: 30, lineHeight: 38, fontStyle: 'italic', fontFamily: 'serif' },
  hint: { marginTop: spacing.xs },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
});
