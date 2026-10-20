import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useTheme } from '@/ui/theme-context';

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { theme } = useTheme();
  const colors = theme.colors;

  return (
    <Tabs
      screenOptions={{
        // Each tab screen renders its own <Screen title=…> header. The navigator
        // header was an extra bar above it, showing the same title twice and
        // eating vertical space on small phones.
        headerShown: false,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text as any,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary as any,
        tabBarInactiveTintColor: colors.textMuted as any,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Safety',
          tabBarLabel: 'Safety',
          tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color as any} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Emergency contacts',
          tabBarLabel: 'Contacts',
          tabBarIcon: ({ color }) => <TabIcon glyph="☎" color={color as any} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Emergency history',
          tabBarLabel: 'History',
          tabBarIcon: ({ color }) => <TabIcon glyph="☰" color={color as any} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color as any} />,
        }}
      />
    </Tabs>
  );
}
