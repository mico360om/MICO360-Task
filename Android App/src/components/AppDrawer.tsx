import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../core/theme';
import { spacing, radius, hexToRgba, type Palette } from '../lib/theme';
import { useDrawerStore } from '../lib/drawer-store';
import { DRAWER_ITEMS, activeDrawerKey } from '../navigation/drawer-menu';
import type { NavAction } from '../navigation/nav-actions';
import { navigationRef } from '../navigation/ref';
import { AppText } from './ui';

const PANEL_WIDTH = Math.min(300, Math.round(Dimensions.get('window').width * 0.82));
const OPEN_MS = 220;
const CLOSE_MS = 180;

/**
 * Left slide-in navigation drawer (A0.x). Built on `Animated` + `Modal` instead of
 * react-native-drawer/reanimated so the app keeps its lean, low-resource dependency set. Reads its
 * open state from the global drawer store; `onNavigate` performs the chosen destination and the
 * drawer then closes itself.
 */
export function AppDrawer({ onNavigate }: { onNavigate: (action: NavAction) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const open = useDrawerStore((s) => s.open);
  const closeDrawer = useDrawerStore((s) => s.closeDrawer);
  const s = makeStyles(c);

  // Keep the Modal mounted through the exit animation so the panel slides out instead of snapping.
  const [rendered, setRendered] = useState(open);
  const anim = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (open) {
      setRendered(true);
      Animated.timing(anim, { toValue: 1, duration: OPEN_MS, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: CLOSE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [open, anim]);

  if (!rendered) return null;

  const activeKey = activeDrawerKey(
    navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined,
  );

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0] });
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const select = (action: NavAction) => {
    closeDrawer();
    onNavigate(action);
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={closeDrawer}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close menu" onPress={closeDrawer} />
        </Animated.View>
        <Animated.View
          style={[s.panel, { paddingTop: insets.top, transform: [{ translateX }] }] as ViewStyle[]}
        >
          <View style={[s.header, { paddingTop: spacing.lg }]}>
            <AppText variant="title" color={c.onBrand}>MICO360</AppText>
            <AppText variant="caption" color={hexToRgba(c.onBrand, 0.85)}>Tasks</AppText>
          </View>
          <ScrollView contentContainerStyle={{ paddingVertical: spacing.sm, paddingBottom: insets.bottom + spacing.md }}>
            {DRAWER_ITEMS.map((item) => {
              const active = item.key === activeKey;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => select(item.action)}
                  style={({ pressed }) => [s.row, active && s.rowActive, pressed && s.rowPressed]}
                >
                  <AppText variant="body" style={s.icon}>{item.icon}</AppText>
                  <AppText variant={active ? 'bodyStrong' : 'body'} color={active ? c.brand : c.ink}>
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    panel: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: PANEL_WIDTH,
      backgroundColor: c.surface,
      borderRightWidth: 1,
      borderRightColor: c.line,
    },
    header: {
      backgroundColor: c.brand,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      gap: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      marginHorizontal: spacing.sm,
    },
    rowActive: { backgroundColor: c.brandWash },
    rowPressed: { opacity: 0.7 },
    icon: { width: 22, textAlign: 'center' },
  });
}
