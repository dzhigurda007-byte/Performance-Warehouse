import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Scanner } from '../../components/Scanner';
import { Button, Field, s, showError } from '../../components/ui';
import * as repo from '../../db/repo';

export default function ItemEdit() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [form, setForm] = useState({ sku: '', name: '', unit: 'шт', barcode: '', description: '' });
  const [scan, setScan] = useState(false);

  useEffect(() => {
    if (id) {
      repo.getItem(db, Number(id)).then((i) => i && setForm({
        sku: i.sku, name: i.name, unit: i.unit, barcode: i.barcode ?? '', description: i.description ?? '',
      }));
    } else {
      repo.suggestSku(db).then((sku) => setForm((f) => ({ ...f, sku })));
    }
  }, [db, id]);

  async function save() {
    try {
      const newId = await repo.saveItem(db, { id: id ? Number(id) : undefined, ...form });
      if (id) router.back();
      else router.replace({ pathname: '/item/[id]', params: { id: String(newId) } });
    } catch (e) {
      showError(e);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Field label="Наименование *" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
      <Field label="Артикул (используется в QR-коде товара) *" value={form.sku} autoCapitalize="characters"
        onChangeText={(sku) => setForm({ ...form, sku })} />
      <Field label="Единица измерения" value={form.unit} onChangeText={(unit) => setForm({ ...form, unit })} />
      <View style={[s.rowWrap, { alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Field label="Штрихкод производителя" value={form.barcode} keyboardType="number-pad"
            onChangeText={(barcode) => setForm({ ...form, barcode })} />
        </View>
        <Button title="⌗" variant="secondary" style={{ marginBottom: 12 }} onPress={() => setScan(true)} />
      </View>
      <Field label="Описание" value={form.description} multiline
        onChangeText={(description) => setForm({ ...form, description })} />
      <Button title="Сохранить" onPress={save} />
      <Scanner visible={scan} title="Штрихкод товара" onClose={() => setScan(false)}
        onScan={(code) => {
          setForm((f) => ({ ...f, barcode: code }));
          setScan(false);
          return true;
        }} />
    </ScrollView>
  );
}
