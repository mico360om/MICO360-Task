import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Button, TextField } from '../ui';
import { SheetMessage } from '../meeting/sheet-kit';
import { COLOR_NAMES, PROJECT_COLORS, PROJECT_ICON_GLYPH, PROJECT_ICON_KEYS, PROJECT_ICON_LABEL, colorName, customColor, readableOn } from '../../lib/project-identity';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

/**
 * How a project looks (the New / Edit project form), as on the website: a colour and an icon (or
 * its initials), or a picture from the phone. A picture set is shown instead of the icon.
 */
export function IdentityPicker({
  color,
  icon,
  hasPicture,
  pictureProblem,
  onColor,
  onIcon,
  onPick,
  onRemovePicture,
  disabled,
}: {
  color: string;
  icon: string | null;
  hasPicture: boolean;
  pictureProblem: string | null;
  onColor: (c: string) => void;
  onIcon: (i: string | null) => void;
  onPick: () => void;
  onRemovePicture: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [tab, setTab] = useState<'icon' | 'image'>(hasPicture ? 'image' : 'icon');
  const [custom, setCustom] = useState(PROJECT_COLORS.includes(color.toUpperCase()) ? '' : color);
  const customBad = custom.trim() !== '' && customColor(custom) === null;
  const textOn = readableOn(color);

  const tabButton = (t: 'icon' | 'image', label: string) => (
    <Pressable
      onPress={() => setTab(t)}
      accessibilityRole="tab"
      accessibilityState={{ selected: tab === t }}
      style={({ pressed }) => [s.seg, tab === t && s.segOn, pressed && s.pressed]}
    >
      <Text style={[s.segText, tab === t && s.segTextOn]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.panel}>
      <View style={s.segs} accessibilityRole="tablist" accessibilityLabel="Appearance">
        {tabButton('icon', 'Icon & colour')}
        {tabButton('image', 'Image')}
      </View>

      {tab === 'icon' ? (
        <View style={s.gap}>
          {hasPicture ? <Text style={s.note}>A picture is set, so it is shown instead of the icon. Remove it on the Image tab to use the icon.</Text> : null}
          <Text style={s.legend} accessibilityRole="header">
            Colour
          </Text>
          <View style={s.swatches} accessibilityRole="radiogroup" accessibilityLabel="Colour">
            {PROJECT_COLORS.map((hex) => {
              const on = color.toUpperCase() === hex;
              return (
                <Pressable
                  key={hex}
                  onPress={() => {
                    setCustom('');
                    onColor(hex);
                  }}
                  disabled={disabled}
                  accessibilityRole="radio"
                  accessibilityLabel={COLOR_NAMES[hex] ?? hex}
                  accessibilityState={{ selected: on, checked: on, disabled: !!disabled }}
                  style={({ pressed }) => [s.swatchHit, pressed && s.pressed]}
                >
                  <View style={[s.swatch, { backgroundColor: hex }, on && { borderColor: c.ink, borderWidth: 3 }]}>{on ? <Text style={{ color: readableOn(hex), fontWeight: '800' }}>✓</Text> : null}</View>
                </Pressable>
              );
            })}
          </View>
          <TextField
            label="Custom colour"
            value={custom}
            onChangeText={(t) => {
              setCustom(t);
              const hex = customColor(t);
              if (hex) onColor(hex);
            }}
            placeholder="#1E5A8B"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            error={customBad ? 'Use a colour like #8B1E1E.' : null}
            accessibilityLabel={`Custom colour, now ${colorName(color)}`}
            editable={!disabled}
          />

          <Text style={s.legend} accessibilityRole="header">
            Icon
          </Text>
          <View style={s.icons} accessibilityRole="radiogroup" accessibilityLabel="Icon">
            {[null, ...PROJECT_ICON_KEYS].map((key) => {
              const on = icon === key;
              return (
                <Pressable
                  key={key ?? 'initials'}
                  onPress={() => onIcon(key)}
                  disabled={disabled}
                  accessibilityRole="radio"
                  accessibilityLabel={key ? PROJECT_ICON_LABEL[key] : 'Initials'}
                  accessibilityState={{ selected: on, checked: on, disabled: !!disabled }}
                  style={({ pressed }) => [s.iconCell, on ? { backgroundColor: color, borderColor: color } : null, pressed && s.pressed]}
                >
                  <Text allowFontScaling={false} style={[s.iconGlyph, { color: on ? textOn : c.ink2 }]}>
                    {key ? PROJECT_ICON_GLYPH[key] : 'Aa'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={s.gap}>
          <Text style={s.note}>A logo or picture from this phone. PNG, JPG or WebP, up to 2 MB.</Text>
          <Button title={hasPicture ? 'Replace picture' : 'Choose a picture'} onPress={onPick} disabled={disabled} />
          {hasPicture ? <Button title="Remove picture" variant="ghost" onPress={onRemovePicture} disabled={disabled} /> : null}
          <SheetMessage text={pictureProblem} />
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pressed: { opacity: 0.7 },
    panel: { borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, backgroundColor: c.ground, padding: spacing.md, gap: spacing.md },
    segs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignSelf: 'flex-start', backgroundColor: c.line, borderRadius: radius.md, padding: 4 },
    seg: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.sm },
    segOn: { backgroundColor: c.surface },
    segText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink2 },
    segTextOn: { color: c.ink, fontWeight: '800' },
    gap: { gap: spacing.sm },
    note: { fontSize: fontSize.sm, color: c.ink2 },
    legend: { fontSize: fontSize.xs, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: c.ink2 },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    swatchHit: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    swatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
    icons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    iconCell: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
    iconGlyph: { fontSize: 20, fontWeight: '800' },
  });
