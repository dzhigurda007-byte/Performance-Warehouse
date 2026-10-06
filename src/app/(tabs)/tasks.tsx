import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, Text, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Badge, Button, Empty, Muted, colors, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { statusOf } from '../../core/receiptCheck';
import type { DocType, DocumentRow } from '../../core/types';
import { useApi, useBackend, usePerms } from '../../lib/backend';

type Kind = 'all' | 'receipt' | 'issue';
type Row = { kind: 'head'; key: string; title: string } | { kind: 'doc'; key: string; doc: DocumentRow };

const BAR: Record<ReturnType<typeof statusOf>, string> = { short: '#F04438', ok: '#17B26A', over: '#F79009', extra: '#F79009' };

/**
 * Общий пул заданий: задания на приёмку и на отбор (расход), составленные на ПК.
 * Кладовщик открывает задание — оно закрепляется за ним, его ФИО попадает в ордер.
 */
export default function TasksScreen() {
  const api = useApi();
  const { user } = useBackend();
  const p = usePerms();
  const [kind, setKind] = useState<Kind>('all');
  // составлять задания: руководитель — везде, кладовщик — на ПК
  const canCreate = p.manageUsers || (p.operate && Platform.OS === 'web');
  const [docs, reload] = useFocusLoad(() => api.listDocuments({ status: 'draft', task: true }), [api]);

  const rows = useMemo(() => {
    const list = (docs ?? []).filter((d) => kind === 'all' || d.type === kind);
    const mine = list.filter((d) => d.assignee_id === user?.id);
    const free = list.filter((d) => !d.assignee_id);
    const others = list.filter((d) => d.assignee_id && d.assignee_id !== user?.id);
    const out: Row[] = [];
    const add = (title: string, l: DocumentRow[]) => {
      if (!l.length) return;
      out.push({ kind: 'head', key: `h-${title}`, title: `${title} · ${l.length}` });
      for (const d of l) out.push({ kind: 'doc', key: `d${d.id}`, doc: d });
    };
    add('Мои задания', mine);
    add('Свободные (общий пул)', free);
    add('В работе у других', others);
    return out;
  }, [docs, kind, user?.id]);

  async function newTask(type: DocType) {
    try {
      const id = await api.createDocument(type, 'plan');
      router.push({ pathname: '/doc/[id]', params: { id: String(id) } });
    } catch (e) {
      showError(e);
    }
  }

  async function take(d: DocumentRow) {
    try {
      await api.takeTask(d.id);
      router.push({ pathname: '/doc/[id]', params: { id: String(d.id) } });
    } catch (e) {
      showError(e);
      reload();
    }
  }

  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.content}
        data={rows}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={
          <View>
            {canCreate ? (
              <View style={s.rowWrap}>
                <Button title="Задание на приёмку" icon="↓" variant="secondary" style={{ flex: 1 }} onPress={() => newTask('receipt')} />
                <Button title="Задание на отбор" icon="↑" variant="secondary" style={{ flex: 1 }} onPress={() => newTask('issue')} />
              </View>
            ) : null}
            {canCreate ? (
              <Button title="Задание на приёмку из Excel" icon="⊞" variant="ghost"
                onPress={() => router.push({ pathname: '/import', params: { kind: 'receipt' } })} />
            ) : null}
            <Chips value={kind} onChange={setKind} options={[
              { value: 'all' as Kind, label: 'Все' },
              { value: 'receipt' as Kind, label: '↓ Приёмка' },
              { value: 'issue' as Kind, label: '↑ Отбор (расход)' },
            ]} />
          </View>
        }
        ListEmptyComponent={docs ? <Empty text="Открытых заданий нет" /> : null}
        renderItem={({ item: r }) => {
          if (r.kind === 'head') return <Text style={[s.section, { marginTop: 14, marginBottom: 6 }]}>{r.title}</Text>;
          const d = r.doc;
          const isReceipt = d.type === 'receipt';
          const st = statusOf(d.plan_qty, d.lines_qty);
          const pct = d.plan_qty ? Math.min(1, d.lines_qty / d.plan_qty) : 0;
          return (
            <Pressable onPress={() => (d.assignee_id ? router.push({ pathname: '/doc/[id]', params: { id: String(d.id) } }) : take(d))}
              style={({ pressed }) => [s.card, { marginBottom: 8, padding: 14 }, pressed && { opacity: 0.8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 22, color: isReceipt ? colors.success : colors.danger }}>{isReceipt ? '↓' : '↑'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
                    {isReceipt ? 'Приёмка' : 'Отбор'} {d.number}
                  </Text>
                  <Muted>{[isReceipt ? d.partner : d.recipient, d.comment, d.warehouse_name].filter(Boolean).join(' · ') || d.doc_date.slice(0, 16)}</Muted>
                </View>
                {d.assignee_id ? <Badge text={d.assignee_id === user?.id ? 'у меня' : d.assignee_name ?? ''} tone={d.assignee_id === user?.id ? 'primary' : 'muted'} />
                  : <Badge text="свободно" tone="success" />}
              </View>
              <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: 10, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round(pct * 100)}%`, height: 8, backgroundColor: BAR[st] }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Muted>{d.plan_count} поз. · {isReceipt ? 'принято' : 'отобрано'} {formatQty(d.lines_qty)} из {formatQty(d.plan_qty)}</Muted>
                {!d.assignee_id ? <Text style={{ color: colors.primary, fontWeight: '600' }}>Взять в работу ›</Text> : null}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
