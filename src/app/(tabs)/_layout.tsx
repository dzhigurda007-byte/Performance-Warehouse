import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';
import { colors } from '../../components/ui';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Операции', tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="storage" options={{ title: 'Склад', tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="items" options={{ title: 'Товары', tabBarIcon: icon('◫') }} />
      <Tabs.Screen name="docs" options={{ title: 'Документы', tabBarIcon: icon('≣') }} />
      <Tabs.Screen name="history" options={{ title: 'История', tabBarIcon: icon('↺') }} />
    </Tabs>
  );
}
