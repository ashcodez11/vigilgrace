/**
 * VigilGrace icon family — 24px grid, 1.75 stroke, round caps/joins.
 * Every icon is a plain outline so weight and size stay consistent.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'shield-alert'
  | 'location'
  | 'contacts'
  | 'lock'
  | 'history'
  | 'sliders'
  | 'check'
  | 'check-circle'
  | 'close'
  | 'warning'
  | 'activity'
  | 'profile'
  | 'chevron-right';

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  /** Omit for decorative icons (hidden from screen readers). */
  label?: string;
}

export function Icon({ name, size = 24, color, strokeWidth = 1.75, label }: IconProps) {
  const s = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={!!label}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      {name === 'shield-alert' && (
        <>
          <Path {...s} d="M12 3l7 3v5.5c0 4.7-3 8.2-7 9.5-4-1.3-7-4.8-7-9.5V6l7-3z" />
          <Path {...s} d="M12 8.5v4" />
          <Circle cx={12} cy={15.6} r={0.9} fill={color} />
        </>
      )}
      {name === 'location' && (
        <>
          <Path {...s} d="M12 21s6-5.6 6-11a6 6 0 10-12 0c0 5.4 6 11 6 11z" />
          <Circle {...s} cx={12} cy={10} r={2.2} />
        </>
      )}
      {name === 'contacts' && (
        <>
          <Circle {...s} cx={9} cy={8} r={3} />
          <Path {...s} d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
          <Circle {...s} cx={17} cy={9} r={2.2} />
          <Path {...s} d="M16.2 14.2c2.6 0 4.3 1.6 4.3 4.3" />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect {...s} x={5} y={10.5} width={14} height={10} rx={2.5} />
          <Path {...s} d="M8 10.5V8a4 4 0 018 0v2.5" />
          <Circle cx={12} cy={15.5} r={1} fill={color} />
        </>
      )}
      {name === 'history' && (
        <>
          <Circle {...s} cx={12} cy={12} r={9} />
          <Path {...s} d="M12 7v5l3 2" />
        </>
      )}
      {name === 'sliders' && (
        <>
          <Path {...s} d="M4 7h9M19 7h1M4 17h1M11 17h9" />
          <Circle {...s} cx={16} cy={7} r={2.2} />
          <Circle {...s} cx={8} cy={17} r={2.2} />
        </>
      )}
      {name === 'check' && <Path {...s} d="M5 12.5l4.5 4.5L19 7.5" />}
      {name === 'check-circle' && (
        <>
          <Circle {...s} cx={12} cy={12} r={9} />
          <Path {...s} d="M8 12.5l3 3 5-6" />
        </>
      )}
      {name === 'close' && <Path {...s} d="M6 6l12 12M18 6L6 18" />}
      {name === 'warning' && (
        <>
          <Path {...s} d="M12 4l9 16H3L12 4z" />
          <Path {...s} d="M12 10v4" />
          <Circle cx={12} cy={17} r={0.9} fill={color} />
        </>
      )}
      {name === 'activity' && <Path {...s} d="M3 12h4l3-7 4 14 3-7h4" />}
      {name === 'profile' && (
        <>
          <Circle {...s} cx={12} cy={8} r={3.5} />
          <Path {...s} d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" />
        </>
      )}
      {name === 'chevron-right' && <Path {...s} d="M9 6l6 6-6 6" />}
    </Svg>
  );
}
