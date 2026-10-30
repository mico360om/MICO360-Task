import { Image } from 'react-native';
import LOGO_LIGHT from '../../../assets/brand/logo.png';
import LOGO_DARK from '../../../assets/brand/logo-w.png';
import { useTheme } from '../../core/theme';

/**
 * The MICO360 logo, one picture per theme (the website's own files): dark letters on the light
 * theme, white letters on the dark one. 409 × 192 at `height`.
 */
export function BrandLogo({ height = 28 }: { height?: number }) {
  const { scheme } = useTheme();
  return (
    <Image
      source={scheme === 'dark' ? LOGO_DARK : LOGO_LIGHT}
      style={{ height, width: Math.round((height * 409) / 192) }}
      resizeMode="contain"
      accessible
      accessibilityRole="image"
      accessibilityLabel="MICO360"
    />
  );
}
