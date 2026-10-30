import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { iconDef, type IconName, type Shape } from '../lib/icons';

export interface IconProps {
  name: IconName;
  /** Width and height in dp (default 20). */
  size?: number;
  color: string;
  /** Overrides the icon's own stroke width. */
  strokeWidth?: number;
  rotate?: 0 | 90 | 180 | 270;
  /** Read by TalkBack when given; without it the icon is decoration (the button names it). */
  label?: string;
}

/** One of the website's drawn icons (lib/icons.ts), in `color`. */
export function Icon({ name, size = 20, color, strokeWidth, rotate = 0, label }: IconProps) {
  const def = iconDef(name);
  const viewBox = def.viewBox ?? '0 0 24 24';
  const [, , w = 24, h = 24] = viewBox.split(' ').map(Number);
  const stroke = strokeWidth ?? def.strokeWidth;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      accessible={Boolean(label)}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      <G
        fill={def.filled ? color : 'none'}
        stroke={stroke > 0 ? color : 'none'}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={rotate ? `rotate(${rotate} ${w / 2} ${h / 2})` : undefined}
      >
        {def.shapes.map((s, i) => (
          <ShapeView key={i} shape={s} color={color} />
        ))}
      </G>
    </Svg>
  );
}

function ShapeView({ shape: s, color }: { shape: Shape; color: string }) {
  if (s.el === 'circle') return <Circle cx={s.cx} cy={s.cy} r={s.r} {...(s.fill ? { fill: color } : null)} />;
  if (s.el === 'rect') return <Rect x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />;
  return <Path d={s.d} {...(s.fill ? { fill: color, fillOpacity: s.fillOpacity } : null)} />;
}
