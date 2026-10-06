import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Button, Card, ListRow, Muted, Section, colors, notify, s, showError, useFocusLoad } from '../components/ui';
import { formatQty } from '../core/codes';
import type { ImportRow } from '../core/services/items';
import { useApi } from '../lib/backend';
import { pickExcel } from '../lib/excel';

/**
 * Загрузка из Excel:
 *  kind=items   — номенклатура (справочник): Артикул, Название, ШК [, Группа];
 *  kind=receipt — приходный ордер: + Количество; после проведения товар в буферной ячейке.
 */
export default function ImportScreen() {
  const api = useApi();
  const kind = useLocalSearchParams<{ kind?: string }>().kind === 'receipt' ? 'receipt' : 'items';
  const [file, setFile] = useState<{ name: string; rows: ImportRow[] } | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [whs] = useFocusLoad(async () => {
    const list = await api.listWarehouses();
    if (list.length && warehouseId === null) setWarehouseId(list[0].id);
    return list;
  }, [api]);

  async function choose() {
    try {
      const f = await pickExcel();
      if (f) setFile(f);
    } catch (e) {
      showError(e);
    }
  }

  async function load() {
    if (!file) return;
    setBusy(true);
    try {
      if (kind === 'items') {
        const r = await api.importItems(file.rows);
        notify('Номенклатура загружена', `Создано: ${r.created}, обновлено: ${r.updated}, пропущено: ${r.skipped}` +
          (r.errors.length ? `\n\nОшибки:\n${r.errors.slice(0, 10).join('\n')}` : ''));
        router.back();
      } else {
        if (!warehouseId) throw new Error('Выберите склад');
        const r = await api.createReceiptFromRows(warehouseId, file.rows, `Загружен из ${file.name}`);
        if (r.errors.length) notify('Часть строк пропущена', r.errors.slice(0, 10).join('\n'));
        router.replace({ pathname: '/doc/[id]', params: { id: String(r.docId) } });
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>
          {kind === 'items' ? 'Номенклатура из Excel' : 'Приходный ордер из Excel'}
        </Text>
        <Muted>Формат: первая строка — заголовки столбцов.</Muted>
        <Text style={{ fontFamily: 'monospace', color: colors.text, marginVertical: 8 }}>
          {kind === 'items' ? 'артикул | Название | ШК | Группа (необяз.)' : 'артикул | Название | ШК | Количество'}
        </Text>
        <Muted>
          {kind === 'items'
            ? 'Номенклатура — это справочник возможных наименований (как в 1С), а не товар на складе. Существующие артикулы обновятся.'
            : 'Неизвестные товары будут добавлены в номенклатуру. После проведения товар окажется в буферной ячейке склада — разложите его перемещением.'}
        </Muted>
        <Button title={file ? `Файл: ${file.name}` : 'Выбрать файл .xlsx'} variant="secondary" icon="⊞" onPress={choose} />
      </Card>

      {kind === 'receipt' && whs && whs.length > 1 ? (
        <Card>
          <Muted>Склад</Muted>
          <Chips value={warehouseId ?? 0} onChange={setWarehouseId} options={whs.map((w) => ({ value: w.id, label: w.name }))} />
        </Card>
      ) : null}

      {file ? (
        <Section title={`Строк: ${file.rows.length}`}>
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {file.rows.slice(0, 30).map((r, i) => (
              <ListRow key={i} title={r.name || '(без названия)'} subtitle={`${r.sku || '—'} · ШК ${r.barcode || '—'}${r.group ? ' · ' + r.group : ''}`}
                right={kind === 'receipt' ? formatQty(r.qty ?? 0) : undefined} />
            ))}
          </View>
          {file.rows.length > 30 ? <Muted>… и ещё {file.rows.length - 30}</Muted> : null}
          <Button title={kind === 'items' ? 'Загрузить в номенклатуру' : 'Создать приходный ордер'} onPress={load} busy={busy}
            disabled={!file.rows.length} />
        </Section>
      ) : null}
    </ScrollView>
  );
}
