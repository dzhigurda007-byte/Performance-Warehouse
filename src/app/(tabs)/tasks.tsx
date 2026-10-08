import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, Text, View } from 'react-native';
import { ActionMenu } from '../../components/ActionMenu';
import { Chips } from '../../components/Chips';
import { Badge, Button, Empty, Muted, colors, s, showError, useFocusLoad } from '../../components/ui';
import { formatQty } from '../../core/codes';
import { statusOf } from '../../core/receiptCheck';
import { ROLE_LABEL } from '../../core/roles';
import type { DocType, DocumentRow } from '../../core/types';
import { useApi, useBackend, usePerms } from '../../lib/backend';

type Kind = 'all' | 'receipt' | 'issue';
type Row = { kind: 'head'; key: string; title: string; hint?: string } | { kind: 'doc'; key: string; doc: DocumentRow };

const BAR: Record<ReturnType<typeof statusOf>, string> = { short: '#F04438', ok: '#17B26A', over: '#F79009', extra: '#F79009' };
const DAYS_DONE = 30;

/**
 * Задания на приёмку и на отбор: ставятся с ПК в общий пул или конкретному сотруднику.
 * Назначенное задание видят исполнитель, постановщик и руководитель. Выполненное возвращается
 * постановщику с отчётом о недостачах и излишках; по отбору формируется расходный ордер.
 */
export default function TasksScreen() {
  const api = useApi();
  const { user } = useBackend();
  const p = usePerms();
  const [kind, setKind] = useState<Kind>('all');
  const [newType, setNewType] = useState<DocType | null>(null);
  // ставить задания: руководитель — везде, кладовщик — на ПК
  const canCreate = p.manageUsers || (p.operate && Platform.OS === 'web');
  const [docs, reload] = useFocusLoad(() => api.listDocuments({ task: true }), [api]);
  const [people] = useFocusLoad(() => (canCreate ? api.listUsers() : Promise.resolve([])), [api, canCreate]);

  const rows = useMemo(() => {
    const since = new Date(Date.now() - DAYS_DONE * 86400000).toISOString().slice(0, 10);
    const list = (docs ?? []).filter((d) => kind === 'all' || d.type === kind);
    const open = list.filter((d) => d.task_status === 'open');
    const done = list.filter((d) => d.task_status === 'done'
      && ((d.completed_at ?? '') >= since || (d.type === 'receipt' && d.status === 'draft') || (d.order_id && d.order_status === 'draft')));
    // отчёты о выполнении — постановщику и руководителю; кладовщику — то, что ждёт проведения
    const reports = done.filter((d) => d.created_by === user?.id || p.manageUsers
      || (p.operate && ((d.type === 'receipt' && d.status === 'draft') || d.order_status === 'draft')));
    const out: Row[] = [];
    const add = (title: string, l: DocumentRow[], hint?: string) => {
      if (!l.length) return;
      out.push({ kind: 'head', key: `h-${title}`, title: `${title} · ${l.length}`, hint });
      for (const d of l) out.push({ kind: 'doc', key: `d${d.id}`, doc: d });
    };
    add('Выполнены — отчёт', reports, 'Недостачи и излишки — в задании; ордер проводит кладовщик или руководитель');
    add('Мои задания', open.filter((d) => d.assignee_id === user?.id));
    add('Свободные (общий пул)', open.filter((d) => !d.assignee_id));
    add('Поставлены другим', open.filter((d) => d.assignee_id && d.assignee_id !== user?.id));
    return out;
  }, [docs, kind, user?.id, p.manageUsers, p.operate]);

  async function newTask(type: DocType, assigneeId: number | null) {
    try {
      const id = await api.createDocument(type, 'plan', { task: true, assigneeId });
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

  const open = (d: DocumentRow) => router.push({ pathname: '/doc/[id]', params: { id: String(d.id) } });

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
                <Button title="Задание на приёмку" icon="↓" variant="secondary" style={{ flex: 1 }} onPress={() => setNewType('receipt')} />
                <Button title="Задание на отбор" icon="↑" variant="secondary" style={{ flex: 1 }} onPress={() => setNewType('issue')} />
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
        ListEmptyComponent={docs ? <Empty text="Заданий нет" /> : null}
        renderItem={({ item: r }) => {
          if (r.kind === 'head') {
            return (
              <View style={{ marginTop: 14, marginBottom: 6 }}>
                <Text style={s.section}>{r.title}</Text>
                {r.hint ? <Muted>{r.hint}</Muted> : null}
              </View>
            );
          }
          const d = r.doc;
          const isReceipt = d.type === 'receipt';
          const st = statusOf(d.plan_qty, d.lines_qty);
          const pct = d.plan_qty ? Math.min(1, d.lines_qty / d.plan_qty) : 0;
          const done = d.task_status === 'done';
          const mine = d.assignee_id === user?.id;
          let badge: { text: string; tone: 'success' | 'primary' | 'muted' | 'warn' | 'danger' };
          if (done) {
            badge = isReceipt
              ? d.status === 'posted' ? { text: 'проведено', tone: 'success' } : { text: 'ждёт проведения', tone: 'warn' }
              : d.order_status === 'posted' ? { text: `ордер ${d.order_number} проведён`, tone: 'success' }
                : d.order_id ? { text: `ордер ${d.order_number} ждёт проведения`, tone: 'warn' } : { text: 'ничего не отобрано', tone: 'danger' };
          } else badge = d.assignee_id ? { text: mine ? 'у меня' : d.assignee_name ?? '', tone: mine ? 'primary' : 'muted' } : { text: 'свободно', tone: 'success' };
          return (
            <Pressable onPress={() => (!done && !d.assignee_id && !p.manageUsers ? take(d) : open(d))}
              style={({ pressed }) => [s.card, { marginBottom: 8, padding: 14 }, pressed && { opacity: 0.8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 22, color: isReceipt ? colors.success : colors.danger }}>{isReceipt ? '↓' : '↑'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
                    {isReceipt ? 'Приёмка' : 'Отбор'} {d.number}
                  </Text>
                  <Muted>{[isReceipt ? d.partner : d.recipient, d.comment, d.warehouse_name].filter(Boolean).join(' · ') || d.doc_date.slice(0, 16)}</Muted>
                  <Muted>
                    Поставил: {d.created_by_name}
                    {done ? ` · выполнил: ${d.completed_by_name ?? d.assignee_name ?? '—'}, ${(d.completed_at ?? '').slice(0, 16)}` : ''}
                  </Muted>
                </View>
                <Badge text={badge.text} tone={badge.tone} />
              </View>
              <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: 10, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round(pct * 100)}%`, height: 8, backgroundColor: BAR[st] }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Muted>{d.plan_count} поз. · {isReceipt ? 'принято' : 'отобрано'} {formatQty(d.lines_qty)} из {formatQty(d.plan_qty)}
                  {done && d.lines_qty !== d.plan_qty ? (d.lines_qty < d.plan_qty ? ' — недостача' : ' — излишек') : ''}</Muted>
                {!done && !d.assignee_id && !p.manageUsers ? <Text style={{ color: colors.primary, fontWeight: '600' }}>Взять ›</Text> : null}
              </View>
            </Pressable>
          );
        }}
      />
      <ActionMenu visible={newType !== null} title={newType === 'receipt' ? 'Задание на приёмку' : 'Задание на отбор'}
        subtitle="Кому поставить задание?" onClose={() => setNewType(null)}
        actions={[
          { label: 'В общий пул (возьмёт любой свободный)', onPress: () => newTask(newType!, null) },
          ...(people ?? []).filter((u) => u.active).map((u) => ({
            label: `${u.full_name} — ${ROLE_LABEL[u.role]}`,
            onPress: () => newTask(newType!, u.id),
          })),
        ]} />
    </View>
  );
}
