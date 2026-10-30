import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { typeStyle, type TypeRole } from '../../lib/typography';
import { toneStyle, type Tone } from '../../lib/tone';
import { useColors } from '../../core/theme';

/**
 * Text in a role of the website's type scale (display/title/heading/…/caption/eyebrow/number),
 * coloured by `tone` (its text tone) or an explicit `color` (default ink).
 */
export function AppText({
  variant = 'body',
  color,
  tone,
  style,
  children,
  ...rest
}: TextProps & { variant?: TypeRole; color?: string; tone?: Tone; children: ReactNode }) {
  const c = useColors();
  const resolved = tone ? toneStyle(c, tone).fg : color ?? c.ink;
  return (
    <Text style={[typeStyle(variant), { color: resolved }, style]} {...rest}>
      {children}
    </Text>
  );
}

/** A page or card title (Archivo ExtraBold). */
export function Heading({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const c = useColors();
  return <Text style={[typeStyle('title'), { color: c.ink }, style]}>{children}</Text>;
}

/** Secondary body text. */
export function Muted({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const c = useColors();
  return <Text style={[typeStyle('body'), { color: c.ink2 }, style]}>{children}</Text>;
}

/** A small upper-case section label, as the website's eyebrows. */
export function SectionTitle({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[typeStyle('eyebrow'), { color: c.ink2, marginBottom: 8 }]}>{children}</Text>;
}
