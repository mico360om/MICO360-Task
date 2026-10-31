import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../core/theme';
import { BRAND_GRADIENT, radius, type Palette } from '../lib/theme';
import { typeStyle } from '../lib/typography';
import { useDrawerStore } from '../lib/drawer-store';
import { drawerSectionsFor, activeDrawerKey, type DrawerItem } from '../navigation/drawer-menu';
import { useServices, useSession } from '../core/providers';
import { useChatBadge } from '../core/chat';
import { useManagementAccess } from '../core/management-queries';
import { chatTabBadge } from '../lib/chat';
import { openWebsitePage } from '../adapters/website';
import { websiteLinkLabel } from '../lib/website';
import type { NavAction } from '../navigation/nav-actions';
import { navigationRef } from '../navigation/ref';
import { Icon } from './Icon';
import { BrandLogo } from './ui';

const PANEL_WIDTH = Math.min(300, Math.round(Dimensions.get('window').width * 0.82));
const OPEN_MS = 220;
const CLOSE_MS = 180;

/**
 * The side menu, as the website's sidebar: the logo, then Workspace / Communication / Admin and the
 * account pages, each row with its drawn icon; the open page's row in the brand gradient. Built on
 * `Animated` + `Modal` (no drawer library). Reads its open state from the global drawer store;
 * `onNavigate` performs the chosen destination and the drawer then closes itself.
 */
export function AppDrawer({ onNavigate }: { onNavigate: (action: NavAction) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const open = useDrawerStore((st) => st.open);
  const closeDrawer = useDrawerStore((st) => st.closeDrawer);
  const s = makeStyles(c);
  // Worked out on every render from the session on screen: a shared phone shows the new person's menu.
  const roles = useSession()?.user.roles ?? [];
  // Management for administrators and people who run a project — as the server says, per person, "no" until it answers.
  const { allowed: canLead } = useManagementAccess();
  const sections = drawerSectionsFor(roles, canLead);
  const chatBadge = chatTabBadge(useChatBadge());
  const { baseUrl } = useServices();

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

  const activeKey = activeDrawerKey(navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0] });
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const select = (action: NavAction) => {
    closeDrawer();
    // A website page (6b) opens in the browser, on the connected server's website.
    if (action.type === 'website') openWebsitePage(baseUrl, action.path);
    else onNavigate(action);
  };

  const row = (item: DrawerItem) => {
    const active = item.key === activeKey;
    const website = item.action.type === 'website';
    const badge = item.key === 'Chat' ? chatBadge : undefined;
    const fg = active ? c.onBrand : c.ink;
    return (
      <Pressable
        key={item.key}
        accessibilityRole={website ? 'link' : 'button'}
        accessibilityLabel={website ? websiteLinkLabel(item.label) : badge !== undefined ? `${item.label}, ${badge} unread` : item.label}
        accessibilityState={{ selected: active }}
        onPress={() => select(item.action)}
        style={({ pressed }) => [s.row, !active && pressed ? s.rowPressed : null]}
      >
        {active ? (
          <LinearGradient colors={BRAND_GRADIENT.colors} locations={BRAND_GRADIENT.locations} start={BRAND_GRADIENT.start} end={BRAND_GRADIENT.end} style={s.rowFill} />
        ) : null}
        <Icon name={item.icon} size={18} color={active ? c.onBrand : c.ink2} />
        <Text style={[typeStyle(active ? 'bodyStrong' : 'body'), s.label, { color: fg }]} numberOfLines={1}>
          {item.label}
        </Text>
        {badge !== undefined ? (
          <View style={[s.badge, { backgroundColor: active ? c.surface : c.brand }]}>
            <Text style={[typeStyle('number'), s.badgeText, { color: active ? c.ink : c.onBrand }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{badge}</Text>
          </View>
        ) : null}
        {website ? <Icon name="kit.globe" size={16} color={active ? c.onBrand : c.ink3} /> : null}
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={closeDrawer}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close menu" onPress={closeDrawer} />
        </Animated.View>
        <Animated.View style={[s.panel, { paddingTop: insets.top, transform: [{ translateX }] }] as ViewStyle[]}>
          <View style={s.header}>
            <BrandLogo height={32} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: insets.bottom + 16 }}>
            {sections.map((section) => (
              <View key={section.key} style={s.section}>
                {section.title ? (
                  <Text style={[typeStyle('eyebrow'), s.sectionTitle, { color: c.ink3 }]} accessibilityRole="header">
                    {section.title}
                  </Text>
                ) : (
                  <View style={[s.divider, { backgroundColor: c.line }]} />
                )}
                {section.items.map(row)}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.scrim },
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
    header: { height: 56, justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: c.line },
    section: { marginBottom: 8 },
    sectionTitle: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
    divider: { height: 1, marginHorizontal: 12, marginVertical: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: radius.button,
    },
    rowFill: { ...StyleSheet.absoluteFillObject, borderRadius: radius.button },
    rowPressed: { backgroundColor: c.ground },
    label: { flex: 1 },
    badge: { minWidth: 20, minHeight: 20, borderRadius: radius.pill, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontSize: 11, lineHeight: 14 },
  });
}
