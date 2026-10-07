import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chips } from '../Chips';
import { Badge, Empty, ListRow, SearchBox, colors, showError } from '../ui';
import { innKpp, isoToRu, type Counterparty } from '../../core/refs';
import { useApi } from '../../lib/backend';

/** Данные стороны одной строкой: реквизиты юр. лица или паспорт физ. лица. */
export function partyDetails(c: Counterparty) {
  if (c.kind === 'person') {
    return [c.inn ? `ИНН ${c.inn}` : '', c.passport_series ? `паспорт ${c.passport_series} ${c.passport_number ?? ''}, выдан ${c.passport_issued_by ?? ''} ${isoToRu(c.passport_issued_at as string)}` : '',
      c.address ? `адрес: ${c.address}` : ''].filter(Boolean).join('\n') || 'данные не заполнены';
  }
  return [innKpp(c) ? `ИНН/КПП ${innKpp(c)}` : '', c.ogrn ? `ОГРН ${c.ogrn}` : '', c.address ?? '',
    c.director ? `${c.director_position ?? 'Руководитель'}: ${c.director}` : ''].filter(Boolean).join('\n') || 'реквизиты не заполнены';
}

/** Выбор контрагента из справочника (юр. и физ. лица). */
export function PartyPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (c: Counterparty) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | 'legal' | 'person'>('');
  const [list, setList] = useState<Counterparty[]>([]);
  useEffect(() => {
    if (visible) api.listParties(kind || null, q).then(setList).catch(showError);
  }, [api, visible, kind, q]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Контрагент</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: colors.primary, fontSize: 16 }}>Закрыть</Text></Pressable>
        </View>
        <SearchBox value={q} onChangeText={setQ} placeholder="Название, ФИО, ИНН" />
        <Chips value={kind} onChange={setKind} options={[
          { value: '' as const, label: 'Все' }, { value: 'legal' as const, label: 'Юр. лица' }, { value: 'person' as const, label: 'Физ. лица' },
        ]} />
        <FlatList style={{ flex: 1, borderRadius: 12 }} data={list} keyExtractor={(c) => String(c.id)}
          ListEmptyComponent={<Empty text="Нет контрагентов — добавьте в «Справочник → Контрагенты»" />}
          renderItem={({ item }) => (
            <ListRow title={item.name} subtitle={partyDetails(item).split('\n')[0]}
              right={<Badge text={item.kind === 'person' ? 'физ.' : 'юр.'} tone="primary" />} onPress={() => onPick(item)} />
          )} />
      </SafeAreaView>
    </Modal>
  );
}
