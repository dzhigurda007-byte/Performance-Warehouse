import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Muted, colors, confirm, notify, s, showError } from '../../components/ui';
import { exportBackup, importBackup, parseBackup } from '../core/backup';
import { pickTextFile, shareTextFile } from '../lib/files';
import { useDb } from '../lib/db';

/** Резервная копия: файл со всей базой — отправить себе (почта, мессенджер, облако) и восстановить на другом телефоне. */
export default function BackupScreen() {
  const db = useDb();
  const [busy, setBusy] = useState<string | null>(null);

  async function save() {
    setBusy('save');
    try {
      const b = await exportBackup(db);
      const stamp = b.created_at.replace(/[: ]/g, '-');
      await shareTextFile(`PerformanceWarehouseLite-${stamp}.json`, JSON.stringify(b));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    try {
      const f = await pickTextFile();
      if (!f) return;
      const data = parseBackup(f.text);
      const items = data.tables.items?.length ?? 0;
      const orders = data.tables.orders?.length ?? 0;
      confirm('Восстановить из копии?',
        `Копия от ${data.created_at}: товаров ${items}, ордеров ${orders}.\n\nВСЕ текущие данные на этом телефоне будут заменены данными из копии.`,
        async () => {
          setBusy('restore');
          try {
            const r = await importBackup(db, data);
            notify('База восстановлена', `Товаров: ${r.items}, ордеров: ${r.orders}, движений: ${r.moves}`);
          } catch (e) {
            showError(e);
          } finally {
            setBusy(null);
          }
        }, 'Заменить данные');
    } catch (e) {
      showError(e);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Сохранить копию базы</Text>
        <Muted>Создаётся один файл со всеми данными: номенклатура, ячейки, остатки, ордера, история, настройки склада.
          Отправьте его себе в мессенджер, на почту или в облако.</Muted>
        <Button title="Сохранить и отправить копию" icon="⇪" busy={busy === 'save'} onPress={save} />
      </Card>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Восстановить / перенести на этот телефон</Text>
        <Muted>1. На старом телефоне — «Сохранить и отправить копию».{'\n'}
          2. На новом телефоне установите PerformanceWarehouseLite, скачайте файл копии и нажмите кнопку ниже.{'\n'}
          Данные на этом телефоне будут полностью заменены.</Muted>
        <Button title="Выбрать файл копии" icon="⤓" variant="secondary" busy={busy === 'restore'} onPress={restore} />
      </Card>
    </ScrollView>
  );
}
