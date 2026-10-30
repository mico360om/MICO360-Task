import { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useServices } from '../core/providers';
import { useColors } from '../core/theme';
import { projectLook } from '../lib/project-identity';
import { PROJECT_AVATAR_SIZES, type ProjectAvatarSize } from '../lib/ui-kit';
import { font } from '../lib/typography';
import { Icon } from './Icon';

export type { ProjectAvatarSize };

/**
 * A project's picture, the same everywhere (as the website's ProjectAvatar): its uploaded picture
 * (only one stored on this server), else its drawn icon on its colour, else its initials. A picture
 * that fails to load falls back to the icon or initials. Decorative by default (the project's name
 * is written next to it); `label` makes it say the project's name when it stands alone. The tile
 * keeps its size at any font size; what it stands for is read out by name.
 */
export function ProjectAvatar({
  project,
  size = 'md',
  label = false,
}: {
  project: { name: string; color?: string | null; icon?: string | null; imageUrl?: string | null };
  size?: ProjectAvatarSize;
  label?: boolean;
}) {
  const { baseUrl } = useServices();
  const c = useColors();
  const look = useMemo(() => projectLook(project, baseUrl), [project, baseUrl]);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [look.picture]);
  const s = PROJECT_AVATAR_SIZES[size];
  const box = { width: s.box, height: s.box, borderRadius: s.radius };
  const a11y = label
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: look.label } as const)
    : ({ accessible: false, importantForAccessibility: 'no-hide-descendants' } as const);

  if (look.picture && !broken) {
    return (
      <View {...a11y} style={[styles.frame, box, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Image source={{ uri: look.picture }} style={styles.fill} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View {...a11y} style={[styles.tile, box, { backgroundColor: look.background }]}>
      {look.icon ? (
        <Icon name={`project.${look.icon}`} size={s.icon} color={look.foreground} />
      ) : (
        <Text allowFontScaling={false} style={[styles.text, { color: look.foreground, fontSize: s.text }]}>
          {look.initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: 1 },
  fill: { width: '100%', height: '100%' },
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  text: { ...font('700'), textAlign: 'center', includeFontPadding: false },
});
