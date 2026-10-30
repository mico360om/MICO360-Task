import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../../core/theme';

/** A centred spinner for a page that is loading. */
export function Loader() {
  const c = useColors();
  return (
    <View style={styles.loader}>
      <ActivityIndicator color={c.brandText} size="large" />
    </View>
  );
}

/** True while the phone asks for less motion (Settings → Accessibility → Remove animations). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** A placeholder bar in the line colour that gently pulses (still when motion is reduced). */
export function Skeleton({ height, width, radius = 8, style }: { height: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (reduce) {
      opacity.setValue(0.6);
      return;
    }
    opacity.setValue(0.4);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, opacity]);
  return <Animated.View style={[{ height, width: (width ?? '100%') as DimensionValue, borderRadius: radius, backgroundColor: c.line, opacity }, style]} />;
}

/** A list of placeholder rows while a list loads; TalkBack hears "Loading". */
export function SkeletonList({ rows = 5, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <View accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }} style={styles.list}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          {avatar ? <Skeleton height={36} width={36} radius={18} /> : null}
          <View style={styles.lines}>
            <Skeleton height={14} width="70%" />
            <Skeleton height={12} width="45%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { gap: 16, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lines: { flex: 1, gap: 8 },
});
