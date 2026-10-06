import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors } from './ui';

/**
 * Сканер: камера телефона (QR, EAN-13/8, Code128/39, DataMatrix, UPC)
 * + поле ручного ввода. Поле ввода в фокусе также принимает данные
 * от аппаратного сканера ТСД, работающего в режиме эмуляции клавиатуры.
 */
/** Результат обработки скана с цветом: red — меньше задания, green — сошлось, yellow — больше. */
export interface ScanFeedback {
  ok: boolean;
  text: string;
  tone?: 'red' | 'green' | 'yellow';
}

const TONE: Record<NonNullable<ScanFeedback['tone']>, { bg: string; fg: string }> = {
  red: { bg: '#B42318', fg: '#fff' },
  green: { bg: '#067647', fg: '#fff' },
  yellow: { bg: '#FDB022', fg: '#1F2937' },
};

export function Scanner({
  visible,
  title = 'Сканирование',
  hint,
  onClose,
  onScan,
}: {
  visible: boolean;
  title?: string;
  hint?: string;
  onClose: () => void;
  /** true — код принят, false — не распознан; ScanFeedback — сообщение с цветом. */
  onScan: (code: string) => Promise<boolean | ScanFeedback> | boolean | ScanFeedback;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [message, setMessage] = useState<ScanFeedback | null>(null);
  const inputRef = useRef<TextInput>(null);
  const lock = useRef(false);
  const last = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (visible) {
      setManual('');
      setMessage(null);
      lock.current = false;
      last.current = null;
    }
  }, [visible]);

  const canAsk = !!perm && !perm.granted && perm.canAskAgain;
  useEffect(() => {
    if (visible && canAsk) requestPerm();
  }, [visible, canAsk, requestPerm]);

  /**
   * camera — камера видит один и тот же код много раз подряд, поэтому повтор в течение 2 с
   * отбрасывается; сканер ТСД (поле ввода) — каждый скан учитывается, даже одинаковый ШК подряд.
   */
  async function handle(code: string, source: 'camera' | 'input') {
    const c = code.trim();
    if (!c || lock.current) return;
    const now = Date.now();
    if (source === 'camera' && last.current && last.current.code === c && now - last.current.at < 2000) return;
    last.current = { code: c, at: now };
    lock.current = true;
    try {
      const res = await onScan(c);
      if (typeof res === 'object') setMessage(res);
      else setMessage(res ? { text: `✓ ${c}`, ok: true } : { text: `Не распознано: ${c}`, ok: false });
    } catch (e) {
      setMessage({ ok: false, tone: 'red', text: e instanceof Error ? e.message : String(e) });
    } finally {
      lock.current = false;
      if (source === 'input') setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={st.header}>
          <Text style={st.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={st.close}>Закрыть</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          {perm?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr', 'datamatrix', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'itf14'],
              }}
              onBarcodeScanned={(r) => handle(r.data, 'camera')}
            />
          ) : (
            <View style={st.center}>
              <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 12 }}>
                Нет доступа к камере. Разрешите доступ или введите код вручную.
              </Text>
              <Button title="Разрешить камеру" onPress={requestPerm} />
            </View>
          )}
          {perm?.granted ? <View pointerEvents="none" style={st.frame} /> : null}
        </View>
        <View style={st.bottom}>
          {hint ? <Text style={st.hint}>{hint}</Text> : null}
          {message?.tone ? (
            <View style={[st.banner, { backgroundColor: TONE[message.tone].bg }]}>
              <Text style={[st.bannerText, { color: TONE[message.tone].fg }]}>{message.text}</Text>
            </View>
          ) : message ? <Text style={[st.msg, message.ok && { color: '#86EFAC' }]}>{message.text}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              ref={inputRef}
              blurOnSubmit={false}
              value={manual}
              onChangeText={setManual}
              placeholder="Код вручную / сканер ТСД"
              placeholderTextColor="#98A2B3"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => {
                handle(manual, 'input');
                setManual('');
              }}
              style={st.input}
            />
            <Button
              title="OK"
              onPress={() => {
                handle(manual, 'input');
                setManual('');
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  close: { color: '#93C5FD', fontSize: 16 },
  center: { flex: 1, justifyContent: 'center', padding: 24 },
  frame: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    top: '20%',
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: '#22C55E',
    borderRadius: 16,
  },
  bottom: { padding: 16, backgroundColor: '#111' },
  hint: { color: '#D0D5DD', marginBottom: 8 },
  msg: { color: '#FCA5A5', marginBottom: 8 },
  banner: { borderRadius: 10, padding: 12, marginBottom: 10 },
  bannerText: { fontSize: 18, fontWeight: '700' },
  input: {
    flex: 1,
    backgroundColor: '#1F2937',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.muted,
  },
});
