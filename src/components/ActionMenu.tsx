import { Modal, Pressable, Text, View } from 'react-native';
import { colors, s } from './ui';

export interface MenuAction {
  label: string;
  onPress: () => void;
  danger?: boolean;
}

/** Меню действий (работает одинаково на телефоне и в браузере на ПК). */
export function ActionMenu({ visible, title, subtitle, actions, onClose }: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  actions: MenuAction[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }}>
        <Pressable style={[s.card, { padding: 8, maxWidth: 440, width: '100%', alignSelf: 'center' }]}>
          {title ? <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, padding: 10 }}>{title}</Text> : null}
          {subtitle ? <Text style={{ color: colors.muted, paddingHorizontal: 10, paddingBottom: 6 }}>{subtitle}</Text> : null}
          {actions.map((a) => (
            <Pressable key={a.label} onPress={() => { onClose(); setTimeout(a.onPress, 250); }}
              style={({ pressed }) => [{ padding: 14, borderRadius: 8 }, pressed && { backgroundColor: colors.bg }]}>
              <Text style={{ fontSize: 16, color: a.danger ? colors.danger : colors.primary }}>{a.label}</Text>
            </Pressable>
          ))}
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
          <Pressable onPress={onClose} style={{ padding: 14 }}>
            <Text style={{ fontSize: 16, color: colors.muted }}>Отмена</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
