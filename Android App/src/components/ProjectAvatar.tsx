import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useServices } from '../core/providers';
import { projectLook } from '../lib/project-identity';

export type ProjectAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZE: Record<ProjectAvatarSize, { box: number; radius: number; text: number; glyph: number }> = {
  xs: { box: 20, radius: 6, text: 9, glyph: 11 },
  sm: { box: 24, radius: 6, text: 10, glyph: 13 },
  md: { box: 32, radius: 8, text: 12, glyph: 17 },
  lg: { box: 44, radius: 12, text: 15, glyph: 22 },
  xl: { box: 64, radius: 16, text: 20, glyph: 32 },
  '2xl': { box: 96, radius: 24, text: 30, glyph: 46 },
};

/**
 * A project's picture, the same everywhere (as the website's ProjectAvatar): its uploaded picture
 * (only one stored on this server), else its icon on its colour, else its initials. A picture that
 * fails to load falls back to the icon or initials. Decorative by default (the project's name is
 * written next to it); `label` makes it say the project's name when it stands alone. The tile keeps
 * its size at any font size; what it stands for is read out by name.
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
  const look = useMemo(() => projectLook(project, baseUrl), [project, baseUrl]);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [look.picture]);
  const s = SIZE[size];
  const box = { width: s.box, height: s.box, borderRadius: s.radius };
  const a11y = label
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: look.label } as const)
    : ({ accessible: false, importantForAccessibility: 'no-hide-descendants' } as const);

  if (look.picture && !broken) {
    return (
      <View {...a11y} style={[styles.frame, box]}>
        <Image source={{ uri: look.picture }} style={styles.fill} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View {...a11y} style={[styles.tile, box, { backgroundColor: look.background }]}>
      <Text allowFontScaling={false} style={[styles.text, { color: look.foreground, fontSize: look.glyph ? s.glyph : s.text }]}>
        {look.glyph ?? look.initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  fill: { width: '100%', height: '100%' },
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  text: { fontWeight: '800', textAlign: 'center', includeFontPadding: false },
});
