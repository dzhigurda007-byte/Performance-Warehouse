import { Pressable, ScrollView, Text } from 'react-native';
import { colors } from './ui';

export function Chips<T extends string | number | boolean | undefined>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 10 }}
      contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={{
            paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
            backgroundColor: active ? colors.primary : colors.card,
            borderWidth: 1, borderColor: active ? colors.primary : colors.border,
          }}>
            <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '500' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
