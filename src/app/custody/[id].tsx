import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { QrView } from '../../components/QrView';
import { Badge, Button, Card, H1, ListRow, Muted, s, showError, useFocusLoad } from '../../components/ui';
import { custodyQr, formatQty } from '../../core/codes';
import { ROLE_LABEL } from '../../core/roles';
import { CONDITION_LABEL, CUSTODY_STATUS_LABEL } from '../../core/types';
import { useApi } from '../../lib/backend';
import { printLabels } from '../../lib/print';

/** Карточка ТМЦ на руках: инвентарный QR, у кого, кто и когда выдал, возврат. */
export default function CustodyCard() {
  const api = useApi();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [k] = useFocusLoad(() => api.getCustody(id), [api, id]);
  if (!k) return null;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <H1>{k.item_name}</H1>
        <Muted>{k.sku} · {formatQty(k.qty)} {k.unit}</Muted>
        <View style={{ marginTop: 6 }}><Badge text={CUSTODY_STATUS_LABEL[k.status]} tone={k.status === 'held' ? 'warn' : 'success'} /></View>
        <QrView value={custodyQr(k.code)} caption={k.code} size={150} />
        <Button title="Печать инвентарной этикетки" icon="⎙" variant="secondary"
          onPress={() => printLabels([{ qr: custodyQr(k.code), title: k.code, subtitle: `${k.item_name} · ${k.holder_name}` }]).catch(showError)} />
        {k.status === 'held' ? (
          <Button title="Вернуть на склад" variant="success" onPress={() => router.push({ pathname: '/return', params: { ids: String(k.id) } })} />
        ) : null}
      </Card>
      <View style={{ borderRadius: 12, overflow: 'hidden' }}>
        <ListRow title={`На руках: ${k.holder_name}`} subtitle={ROLE_LABEL[k.holder_role]} />
        <ListRow title={`Выдал: ${k.issued_by_name}`} subtitle={k.issued_at} right={k.issue_doc_number}
          onPress={() => router.push({ pathname: '/doc/[id]', params: { id: String(k.issue_doc_id) } })} />
        {k.returned_at ? (
          <ListRow title={`Возврат: ${CONDITION_LABEL[k.return_condition ?? 'ok']}`}
            subtitle={`${k.returned_at} · оформил ${k.returned_by_name}${k.return_comment ? `\n«${k.return_comment}»` : ''}`}
            right={k.return_doc_number ?? ''}
            onPress={k.return_doc_id ? () => router.push({ pathname: '/doc/[id]', params: { id: String(k.return_doc_id) } }) : undefined} />
        ) : null}
      </View>
    </ScrollView>
  );
}
