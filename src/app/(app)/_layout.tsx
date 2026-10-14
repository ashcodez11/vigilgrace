import { Stack } from 'expo-router';

import { colors } from '@/ui/theme';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="tabs" options={{ headerShown: false }} />
      <Stack.Screen name="motion" options={{ title: 'Motion trigger' }} />
      <Stack.Screen name="voice" options={{ title: 'Voice distress' }} />
      <Stack.Screen name="pendant" options={{ title: 'Pendant (BLE)' }} />
      <Stack.Screen name="security" options={{ title: 'Secure communication' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile & permissions' }} />
    </Stack>
  );
}
