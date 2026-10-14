/**
 * Root layout: providers + auth bootstrap.
 */

import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemeProvider } from '@/ui/theme-context';
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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </GestureHandlerRootView>
  );
}
