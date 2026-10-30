import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { serverFileHref } from '../../lib/attachments';
import { personInitials } from '../../lib/initials';
import { font } from '../../lib/typography';
import { AVATAR_SIZES, type AvatarSize } from '../../lib/ui-kit';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';

/**
 * A person's picture, the same everywhere (the website's Avatar): their photo when it is stored on
 * this server, else their initials in the brand colour on its wash; a thin surface ring. A photo
 * that fails to load shows the initials. Decorative unless `label` (then it says their name).
 */
export function Avatar({ name, size = 'md', src, label = false }: { name: string; size?: AvatarSize; src?: string | null; label?: boolean }) {
  const { baseUrl } = useServices();
  const c = useColors();
  const href = serverFileHref(baseUrl, src);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [href]);
  const s = AVATAR_SIZES[size];
  const box = { width: s.box, height: s.box, borderRadius: s.box / 2, borderColor: c.surface };
  const a11y = label
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: name } as const)
    : ({ accessible: false, importantForAccessibility: 'no-hide-descendants' } as const);
  if (href && !broken) {
    return (
      <View {...a11y} style={[styles.ring, box]}>
        <Image source={{ uri: href }} style={styles.fill} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
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
});
