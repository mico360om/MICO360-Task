import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_GRADIENT, radius, shadow } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { DASHBOARD_TEXT } from '../../lib/dashboard';
import { useColors } from '../../core/theme';

/**
 * The website's welcome band at the top of the Dashboard: the brand gradient, today in the company
 * zone ("Friday 30 October") over the greeting — the page's title — and the two ways in, "Open board"
 * (the All projects board) and "View my tasks". On the first day the links hide: the first steps
 * below take their place.
 */
export function WelcomeBand({
  dateLine,
  greeting,
  showLinks,
  onOpenBoard,
  onViewMyTasks,
}: {
  dateLine: string;
  greeting: string;
  showLinks: boolean;
  onOpenBoard: () => void;
  onViewMyTasks: () => void;
}) {
  const c = useColors();
  return (
    <View style={[s.band, shadow.brand]}>
      <LinearGradient colors={BRAND_GRADIENT.colors} locations={BRAND_GRADIENT.locations} start={BRAND_GRADIENT.start} end={BRAND_GRADIENT.end} style={s.fill} />
      <Text style={[typeStyle('eyebrow'), s.date, { color: c.onBrand }]}>{dateLine}</Text>
      <Text style={[s.greeting, { color: c.onBrand }]} accessibilityRole="header">
        {greeting}
      </Text>
      {showLinks ? (
        <View style={s.links}>
          <Pressable
            onPress={onOpenBoard}
            accessibilityRole="button"
            style={({ pressed }) => [s.link, shadow.soft, { backgroundColor: c.surface }, pressed ? s.pressed : null]}
          >
            <Text style={[typeStyle('button'), { color: c.brandText }]}>{DASHBOARD_TEXT.openBoard}</Text>
          </Pressable>
          <Pressable onPress={onViewMyTasks} accessibilityRole="button" style={({ pressed }) => [s.link, s.outline, { borderColor: c.onBrand }, pressed ? s.pressed : null]}>
            <Text style={[typeStyle('button'), { color: c.onBrand }]}>{DASHBOARD_TEXT.viewMyTasks}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  band: { borderRadius: radius.card, paddingHorizontal: 20, paddingVertical: 16, gap: 2 },
  fill: { ...StyleSheet.absoluteFillObject, borderRadius: radius.card },
  // The website's text-white/70 over the gradient.
  date: { opacity: 0.8 },
  // font-display text-2xl font-extrabold tracking-tightish.
  greeting: { fontSize: 24, lineHeight: 30, ...font('800', 'display'), letterSpacing: -0.3 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  link: { minHeight: 44, borderRadius: radius.button, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1 },
  pressed: { opacity: 0.85 },
});
