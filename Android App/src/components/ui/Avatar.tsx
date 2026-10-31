import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { serverFileHref } from '../../lib/attachments';
import { personInitials } from '../../lib/initials';
import { BRAND_GRADIENT, shadow } from '../../lib/theme';
import { font } from '../../lib/typography';
import { AVATAR_SIZES, type AvatarSize } from '../../lib/ui-kit';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';

/** What TalkBack says for the photo and for the initials shown instead (e.g. the Profile's). */
export type AvatarLabels = { photo: string; initials: string };

/**
 * A person's picture, the same everywhere (the website's Avatar): their photo when it is stored on
 * this server, else their initials in the brand colour on its wash; a thin surface ring. A photo
 * that fails to load shows the initials. Size xl is the website's Profile photo: a line ring, and
 * white bold initials on the brand gradient. Decorative unless `label`: true says their name, a
 * string says that, and AvatarLabels says one thing for the photo and another for the initials.
 */
export function Avatar({ name, size = 'md', src, label = false }: { name: string; size?: AvatarSize; src?: string | null; label?: boolean | string | AvatarLabels }) {
  const { baseUrl } = useServices();
  const c = useColors();
  const href = serverFileHref(baseUrl, src);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [href]);
  const s = AVATAR_SIZES[size];
  const xl = size === 'xl';
  const box = { width: s.box, height: s.box, borderRadius: s.box / 2, borderColor: xl ? c.line : c.surface };
  const showPhoto = !!href && !broken;
  const said = label === false ? null : label === true ? name : typeof label === 'string' ? label : showPhoto ? label.photo : label.initials;
  const a11y =
    said !== null
      ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: said } as const)
      : ({ accessible: false, importantForAccessibility: 'no-hide-descendants' } as const);
  if (showPhoto) {
    return (
      <View {...a11y} style={[styles.ring, box, xl ? shadow.soft : null]}>
        <Image source={{ uri: href }} style={styles.fill} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  if (xl) {
    return (
      <View {...a11y} style={[styles.center, box, styles.xlBox, { backgroundColor: c.brand }, shadow.brand]}>
        <LinearGradient colors={BRAND_GRADIENT.colors} locations={BRAND_GRADIENT.locations} start={BRAND_GRADIENT.start} end={BRAND_GRADIENT.end} style={[StyleSheet.absoluteFill, { borderRadius: s.box / 2 }]} />
        <Text allowFontScaling={false} style={[styles.xlText, { fontSize: s.text, color: c.onBrand }]}>
          {personInitials(name)}
        </Text>
      </View>
    );
  }
  return (
    <View {...a11y} style={[styles.ring, styles.center, box, { backgroundColor: c.brandWash }]}>
      <Text allowFontScaling={false} style={[styles.text, { fontSize: s.text, color: c.brandText }]}>
        {personInitials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderWidth: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
  text: { ...font('600'), includeFontPadding: false, textAlign: 'center' },
  /** The website's span has no border; the gradient fills the circle. */
  xlBox: { borderWidth: 0 },
  xlText: { ...font('700'), includeFontPadding: false, textAlign: 'center' },
});
