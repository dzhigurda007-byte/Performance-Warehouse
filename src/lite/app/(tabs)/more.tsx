import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Badge, Button, Card, Field, ListRow, Muted, Section, colors, notify, s, showError, useFocusLoad } from '../../../components/ui';
import { formatQty } from '../../../core/codes';
import { summary, warehouse, type WarehouseInfo } from '../../core/service';
import { useDb } from '../../lib/db';

/** Склад: реквизиты для печатных форм, ячейки, резервная копия. Пользователь один — администратор. */
export default function MoreTab() {
  const db = useDb();
  const [info, setInfo] = useState<WarehouseInfo>({ name: '', address: '', person: '' });
  const [busy, setBusy] = useState(false);
  const [loaded] = useFocusLoad(async () => ({ wh: await warehouse.get(db), sum: await summary(db) }), [db]);
  useEffect(() => { if (loaded) setInfo(loaded.wh); }, [loaded]);

  async function save() {
    setBusy(true);
    try {
      await warehouse.save(db, info);
      notify('Сохранено');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof WarehouseInfo) => (v: string) => setInfo((c) => ({ ...c, [k]: v }));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 18, fontWeight: '800', color: colors.text }}>PerformanceWarehouseLite</Text>
          <Badge text="Администратор" tone="primary" />
        </View>
        <Muted>Все данные хранятся только в этом телефоне. Версия {Constants.expoConfig?.version ?? ''}</Muted>
        {loaded ? <Muted>Товаров: {loaded.sum.items} · на складе {formatQty(loaded.sum.total)} шт.</Muted> : null}
      </Card>

      <Section title="Склад (для печатных форм)">
        <Card>
          <Field label="Название склада" value={info.name} onChangeText={set('name')} />
          <Field label="Адрес" value={info.address} onChangeText={set('address')} />
          <Field label="Ответственный (ФИО для подписи в ордерах)" value={info.person} onChangeText={set('person')} />
          <Button title="Сохранить" busy={busy} onPress={save} />
        </Card>
      </Section>

      <Section title="Хранение и данные">
        <View style={{ borderRadius: 12, overflow: 'hidden' }}>
          <ListRow title="Стеллажи и ячейки" subtitle="Ряды, полки, ячейки A-1-1, QR-этикетки" right="›" onPress={() => router.push('/cells')} />
          <ListRow title="Перемещение между ячейками" subtitle="Скан: ячейка откуда → товар → ячейка куда" right="›" onPress={() => router.push('/move')} />
          <ListRow title="Резервная копия" subtitle="Сохранить базу или перенести на другой телефон" right="›" onPress={() => router.push('/backup')} />
        </View>
      </Section>
    </ScrollView>
  );
}
