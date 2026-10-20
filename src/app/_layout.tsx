/**
 * Root layout: providers + auth bootstrap + session guard.
 *
 * The guard lives here (not in a `/` screen) because a redirect screen and the
 * dashboard both claimed the `/` path: `src/app/index.tsx` and
 * `src/app/(app)/index.tsx`. Expo Router resolved `/` to the redirect screen, so
 * post-login navigation to `/(app)` bounced between the two and produced
 * "Maximum update depth exceeded" instead of the dashboard.
 */

import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack, router, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemeProvider } from '@/ui/theme-context';
import { LoadingView } from '@/ui/components';
import { useSettingsStore } from '@/state/settings-store';
import { useAuthStore } from '@/state/auth-store';

export default function RootLayout() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const themeId = useSettingsStore((s) => s.themeId);
  const setThemeId = useSettingsStore((s) => s.setThemeId);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ThemeProvider themeId={themeId} setThemeId={setThemeId}>
      <RootLayoutInner />
    </ThemeProvider>
  );
}

function RootLayoutInner() {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';
    if (status === 'signedOut' && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (status === 'signedIn' && inAuthGroup) {
      router.replace('/');
    }
  }, [status, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      {status === 'loading' ? (
        <LoadingView text="Starting VigilGrace…" />
      ) : (
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        />
      )}
    </GestureHandlerRootView>
  );
}
