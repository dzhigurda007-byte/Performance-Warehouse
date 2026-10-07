import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Scanner } from '../../components/Scanner';
import { Button, Field, Muted, colors, s, showError, useFocusLoad } from '../../components/ui';
import { useApi } from '../../lib/backend';

export default function ItemEdit() {
  const api = useApi();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [form, setForm] = useState({ sku: '', name: '', unit: 'шт', barcode: '', description: '', group_id: 0, track_units: false, price: '' });
  const [scan, setScan] = useState(false);
  const [groups] = useFocusLoad(() => api.listGroups(), [api]);

  useEffect(() => {
    if (id) {
      api.getItem(Number(id)).then((i) => i && setForm({
        sku: i.sku, name: i.name, unit: i.unit, barcode: i.barcode ?? '', description: i.description ?? '',
        group_id: i.group_id ?? 0, track_units: !!i.track_units, price: i.price ? String(i.price).replace('.', ',') : '',
      }));
    } else {
      api.suggestSku().then((sku) => setForm((f) => ({ ...f, sku })));
    }
  }, [api, id]);

  async function save() {
    try {
      const newId = await api.saveItem({
        id: id ? Number(id) : undefined, ...form, group_id: form.group_id || null, track_units: form.track_units ? 1 : 0,
        price: form.price.trim() ? Number(form.price.replace(/[\s\u00a0₽]/g, '').replace(',', '.')) : null,
      });
      if (id) router.back();
      else router.replace({ pathname: '/item/[id]', params: { id: String(newId) } });
    } catch (e) {
      showError(e);
    }
  }

  const groupPath = (gid: number): string => {
    const g = groups?.find((x) => x.id === gid);
    return g ? (g.parent_id ? `${groupPath(g.parent_id)} / ${g.name}` : g.name) : '';
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Field label="Наименование *" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
      <Field label="Артикул (используется в QR-коде товара) *" value={form.sku} autoCapitalize="characters"
        onChangeText={(sku) => setForm({ ...form, sku })} />
      <View style={s.rowWrap}>
        <View style={{ flex: 1 }}>
          <Field label="Единица измерения" value={form.unit} onChangeText={(unit) => setForm({ ...form, unit })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Цена без НДС, ₽" value={form.price} keyboardType="decimal-pad" placeholder="0,00"
            onChangeText={(price) => setForm({ ...form, price })} />
        </View>
      </View>
      <View style={[s.rowWrap, { alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Field label="Штрихкод производителя" value={form.barcode} keyboardType="number-pad"
            onChangeText={(barcode) => setForm({ ...form, barcode })} />
        </View>
        <Button title="⌗" variant="secondary" style={{ marginBottom: 12 }} onPress={() => setScan(true)} />
      </View>
      <Muted>Группа</Muted>
      <Chips value={form.group_id} onChange={(g) => setForm({ ...form, group_id: g })}
        options={[{ value: 0, label: 'Без группы' }, ...(groups ?? []).map((g) => ({ value: g.id, label: groupPath(g.id) }))]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>Поштучный учёт при выдаче</Text>
          <Muted>Каждая выданная единица получает свой инвентарный QR (инструмент, техника)</Muted>
        </View>
        <Switch value={form.track_units} onValueChange={(v) => setForm({ ...form, track_units: v })} />
      </View>
      <Field label="Описание" value={form.description} multiline onChangeText={(description) => setForm({ ...form, description })} />
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
