/**
 * Manual SOS control. Presentation only: it never starts, delays or reorders
 * alert logic — `onPress` is called synchronously on the first tap.
 *
 * - ready:     tap fires `onPress` immediately (repeat taps within 700 ms are
 *              ignored so a double tap cannot submit twice).
 * - countdown: shows seconds left; tapping calls `onPress` to CANCEL, never
 *              throttled, so cancellation is always immediate.
 * - sending:   busy and non-interactive; announces progress, not delivery.
 * No decorative motion runs outside `ready`, and none with reduced motion.
 */
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from './haptics';
import { Icon } from './Icon';
import { useTokens } from './use-tokens';

export type SosMode = 'ready' | 'countdown' | 'sending';

const SIZE = 176;
const DEBOUNCE_MS = 700;

export function SosButton({
  mode = 'ready',
  secondsLeft,
  onPress,
}: {
  mode?: SosMode;
  secondsLeft?: number;
  onPress: () => void;
}) {
  const t = useTokens();
  const reduce = useReducedMotion();
  const ring = useSharedValue(0);
  const press = useSharedValue(1);
  const lastFire = useRef(0);

  useEffect(() => {
    if (mode === 'ready' && !reduce) {
      ring.set(withRepeat(
        withSequence(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.quad) })),
        -1,
      ));
    } else {
      cancelAnimation(ring);
      ring.set(0);
    }
    return () => cancelAnimation(ring);
  }, [mode, reduce, ring]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + ring.value * 0.2,
    transform: [{ scale: 1 + ring.value * 0.06 }],
  }));
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const handle = () => {
    if (mode === 'sending') return;
    if (mode === 'ready') {
      const now = Date.now();
      if (now - lastFire.current < DEBOUNCE_MS) return;
      lastFire.current = now;
      haptic('sos');
    } else {
      haptic('warning');
    }
    onPress();
  };

  const countdown = mode === 'countdown';
  const bg = countdown ? t.surface : t.emergency;
  const fg = countdown ? t.dangerText : t.textOnEmergency;
  const label =
    mode === 'ready'
      ? 'Send emergency alert'
      : mode === 'countdown'
        ? `Alert sending in ${secondsLeft ?? 0} seconds. Tap to cancel`
        : 'Sending emergency alert';

  return (
    <View style={styles.wrap}>
      <Animated.View pointerEvents="none" style={[styles.ring, { backgroundColor: t.emergency }, ringStyle]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: mode === 'sending', disabled: mode === 'sending' }}
        onPressIn={() => {
          if (!reduce) press.set(withTiming(0.97, { duration: 70 }));
        }}
        onPressOut={() => {
          if (!reduce) press.set(withTiming(1, { duration: 110 }));
        }}
        onPress={handle}
      >
        <Animated.View
          style={[
            styles.button,
            { backgroundColor: bg, borderColor: t.emergency, opacity: mode === 'sending' ? 0.75 : 1 },
            pressStyle,
          ]}
        >
          {countdown ? (
            <>
              <Text style={[styles.count, { color: fg }]}>{secondsLeft ?? 0}</Text>
              <Text style={[styles.sub, { color: fg }]}>TAP TO CANCEL</Text>
            </>
          ) : (
            <>
              <Icon name="shield-alert" size={44} color={fg} strokeWidth={2} />
              <Text style={[styles.sos, { color: fg }]}>SOS</Text>
              <Text style={[styles.sub, { color: fg }]}>{mode === 'sending' ? 'SENDING…' : 'TAP TO ALERT'}</Text>
            </>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', width: SIZE + 40, height: SIZE + 40, alignSelf: 'center' },
  ring: { position: 'absolute', width: SIZE + 32, height: SIZE + 32, borderRadius: (SIZE + 32) / 2 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  sos: { fontSize: 34, fontWeight: '900', letterSpacing: 2 },
  count: { fontSize: 64, fontWeight: '800' },
  sub: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
});
