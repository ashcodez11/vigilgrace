import { Stack } from 'expo-router';

import { useTheme } from '@/ui/theme-context';

export default function AppLayout() {
  const { theme } = useTheme();
  const colors = theme.colors;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Primary screens live in the (tabs) group, which renders the tab bar. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/*
       * These screens render their own <Screen title subtitle> header, so the
       * navigator header carries only the back affordance. Repeating the title
       * in both places showed every heading twice.
       */}
      <Stack.Screen name="motion" options={{ title: '' }} />
      <Stack.Screen name="voice" options={{ title: '' }} />
      <Stack.Screen name="security" options={{ title: '' }} />
      <Stack.Screen name="profile" options={{ title: '' }} />
    </Stack>
  );
}
