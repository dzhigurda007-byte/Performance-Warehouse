import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { BusinessError } from '../db/repo';

export const colors = {
  bg: '#F2F4F7',
  card: '#FFFFFF',
  text: '#101828',
  muted: '#667085',
  border: '#D0D5DD',
  primary: '#1D4ED8',
  primarySoft: '#DBE7FF',
  success: '#067647',
  successSoft: '#DCFAE6',
  danger: '#B42318',
  dangerSoft: '#FEE4E2',
  warn: '#B54708',
  warnSoft: '#FEF0C7',
};

export function showError(e: unknown) {
  const msg = e instanceof BusinessError ? e.message : `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  Alert.alert('Не выполнено', msg);
}

export function confirm(title: string, message: string, onYes: () => void, yes = 'Да') {
  Alert.alert(title, message, [
    { text: 'Отмена', style: 'cancel' },
    { text: yes, style: 'destructive', onPress: onYes },
  ]);
}

/** Загрузка данных при каждом фокусе экрана (после возврата с дочерних экранов данные свежие). */
export function useFocusLoad<T>(load: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      load().then((d) => alive && setData(d)).catch(showError);
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, tick]),
  );
  return [data, () => setTick((t) => t + 1)];
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

export function Button({
  title, onPress, variant = 'primary', disabled, icon, style, busy,
}: {
  title: string;
  onPress: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  icon?: string;
  style?: ViewStyle;
  busy?: boolean;
}) {
  const v = btn[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, v.box, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}
    >
      {busy ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <Text style={[s.btnText, v.text]}>{icon ? `${icon}  ` : ''}{title}</Text>
      )}
    </Pressable>
  );
}

const btn: Record<BtnVariant, { box: ViewStyle; text: { color: string } }> = {
  primary: { box: { backgroundColor: colors.primary }, text: { color: '#fff' } },
  success: { box: { backgroundColor: colors.success }, text: { color: '#fff' } },
  secondary: { box: { backgroundColor: colors.primarySoft }, text: { color: colors.primary } },
  danger: { box: { backgroundColor: colors.dangerSoft }, text: { color: colors.danger } },
  ghost: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }, text: { color: colors.text } },
};

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[s.input, props.multiline && { minHeight: 70 }]} {...props} />
    </View>
  );
}

export function SearchBox(props: TextInputProps) {
  return (
    <TextInput
      placeholder="Поиск"
      placeholderTextColor={colors.muted}
      clearButtonMode="while-editing"
      style={[s.input, { marginBottom: 10 }]}
      {...props}
    />
  );
}

export function ListRow({
  title, subtitle, right, onPress, onLongPress, left,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  left?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: '#F9FAFB' }]}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSub}>{subtitle}</Text> : null}
      </View>
      {typeof right === 'string' || typeof right === 'number' ? <Text style={s.rowRight}>{right}</Text> : right}
    </Pressable>
  );
}

export function Badge({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'success' | 'warn' | 'danger' | 'primary' }) {
  const map = {
    muted: ['#F2F4F7', colors.muted],
    success: [colors.successSoft, colors.success],
    warn: [colors.warnSoft, colors.warn],
    danger: [colors.dangerSoft, colors.danger],
    primary: [colors.primarySoft, colors.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Section({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ marginTop: 16 }}>
      <View style={s.sectionHead}>
        <Text style={s.section}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.muted, fontSize: 13 }}>{children}</Text>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  btn: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  btnText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 16, color: colors.text, fontWeight: '500' },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowRight: { fontSize: 16, color: colors.text, fontWeight: '600' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 4 },
  rowWrap: { flexDirection: 'row', gap: 8 },
});
