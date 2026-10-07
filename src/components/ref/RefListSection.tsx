import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Badge, Button, Empty, ListRow, Muted, SearchBox, useFocusLoad } from '../ui';
import { contractTitle, innKpp, isoToRu, type RefKind, type RefRecord } from '../../core/refs';
import { money } from '../../core/upd';
import { useApi, usePerms } from '../../lib/backend';

const ADD_TITLE: Record<RefKind, string> = {
  org: 'Новая организация', legal: 'Новое юр. лицо', person: 'Новое физ. лицо', contract: 'Новый договор',
};
const EMPTY: Record<RefKind, string> = {
  org: 'Добавьте свою организацию — она будет продавцом в УПД и стороной договоров',
  legal: 'Юридических лиц пока нет', person: 'Физических лиц пока нет', contract: 'Договоров пока нет',
};

/** Список записей справочника: организации, юр. лица, физ. лица или договоры. */
export function RefListSection({ kind }: { kind: RefKind }) {
  const api = useApi();
  const p = usePerms();
  const [q, setQ] = useState('');
  const [rows] = useFocusLoad<RefRecord[]>(async () => {
    if (kind === 'org') return api.listOrgs();
    if (kind === 'contract') return api.listContracts({ search: q });
    return api.listParties(kind, q);
  }, [api, kind, q]);

  const view = (r: RefRecord) => {
    if (kind === 'contract') {
      return {
        title: contractTitle(r as { title?: string; number: string; date: string }),
        subtitle: [`${r.org_name ?? '—'} ↔ ${r.party_name ?? '—'}`,
          [r.valid_until ? `до ${isoToRu(String(r.valid_until))}` : '', r.amount ? `${money(Number(r.amount))} ₽` : ''].filter(Boolean).join(' · ')]
          .filter(Boolean).join('\n'),
        badge: r.party_kind === 'person' ? 'физ. лицо' : r.party_kind === 'legal' ? 'юр. лицо' : '',
      };
    }
    if (kind === 'person') {
      return {
        title: String(r.name),
        subtitle: [r.inn ? `ИНН ${r.inn}` : '', r.passport_series ? `паспорт ${r.passport_series} ${r.passport_number ?? ''}` : '', r.phone]
          .filter(Boolean).join(' · '),
        badge: '',
      };
    }
    return {
      title: String(r.short_name || r.name),
      subtitle: [innKpp(r) ? `ИНН/КПП ${innKpp(r)}` : 'ИНН не указан', r.legal_address ?? r.address].filter(Boolean).join('\n'),
      badge: kind === 'org' && r.is_default ? 'по умолчанию' : '',
    };
  };

  return (
    <View style={{ flex: 1 }}>
      {kind !== 'org' ? (
        <SearchBox value={q} onChangeText={setQ}
          placeholder={kind === 'contract' ? 'Номер, контрагент, вид договора' : kind === 'person' ? 'ФИО, ИНН' : 'Название, ИНН'} />
      ) : null}
      {p.manageItems ? (
        <Button title={ADD_TITLE[kind]} icon="+" onPress={() => router.push({ pathname: '/ref/[kind]/[id]', params: { kind, id: 'new' } })} />
      ) : null}
      <FlatList
        style={{ flex: 1, marginTop: 10, borderRadius: 12 }}
        data={rows ?? []}
        keyExtractor={(r) => String(r.id)}
        ListEmptyComponent={rows ? <Empty text={EMPTY[kind]} /> : null}
        ListFooterComponent={rows?.length ? <Muted>Записей: {rows.length}</Muted> : null}
        renderItem={({ item }) => {
          const v = view(item);
          return (
            <ListRow title={v.title} subtitle={v.subtitle}
              right={v.badge ? <Badge text={v.badge} tone="primary" /> : undefined}
              onPress={() => router.push({ pathname: '/ref/[kind]/[id]', params: { kind, id: String(item.id) } })} />
          );
        }}
      />
    </View>
  );
}
