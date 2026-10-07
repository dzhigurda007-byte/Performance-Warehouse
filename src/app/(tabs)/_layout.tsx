import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';
import { colors } from '../../components/ui';
import { usePerms } from '../../lib/backend';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
  };

/**
 * Вкладки зависят от роли:
 *  кладовщик и выше — всё; сотрудник — операции (взять себе), номенклатура, выдачи;
 *  разнорабочий — только свои ТМЦ.
 */
export default function TabsLayout() {
  const p = usePerms();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Операции', tabBarIcon: icon('⌂'), href: p.takeForSelf ? undefined : null }} />
      <Tabs.Screen name="tasks" options={{ title: 'Задания', tabBarIcon: icon('☑'), href: p.operate ? undefined : null }} />
      <Tabs.Screen name="storage" options={{ title: 'Склад', tabBarIcon: icon('▦'), href: p.operate ? undefined : null }} />
      <Tabs.Screen name="stock" options={{ title: 'Остатки', tabBarIcon: icon('▤'), href: p.viewStock ? undefined : null }} />
      <Tabs.Screen name="items" options={{ title: 'Справочник', tabBarIcon: icon('◫'), href: p.manageItems ? undefined : null }} />
      <Tabs.Screen name="custody" options={{ title: 'Выдачи', tabBarIcon: icon('⇆'), href: p.custody ? undefined : null }} />
      <Tabs.Screen name="more" options={{ title: 'Ещё', tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
