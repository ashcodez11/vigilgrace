import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

type Kind = 'tap' | 'select' | 'success' | 'warning' | 'sos';

/** Best-effort haptics: never throws, no-op on web. */
export function haptic(kind: Kind): void {
  if (Platform.OS === 'web') return;
  try {
    switch (kind) {
      case 'tap':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'select':
        void Haptics.selectionAsync();
        break;
      case 'success':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'sos':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
    }
  } catch {
    /* haptics are optional */
  }
}
