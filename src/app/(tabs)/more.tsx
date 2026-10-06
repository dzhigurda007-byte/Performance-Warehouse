import { router } from 'expo-router';
import { Platform, ScrollView, Text, View } from 'react-native';
import { Button, Card, ListRow, Muted, Section, colors, confirm, s } from '../../components/ui';
import { ROLE_LABEL } from '../../core/roles';
import { useBackend, usePerms } from '../../lib/backend';

export default function MoreScreen() {
  const { user, mode, serverUrl, settings, logout, resetConnection } = useBackend();
  const p = usePerms();
  if (!user) return null;
  const link = (title: string, subtitle: string, path: Parameters<typeof router.push>[0]) => (
    <ListRow title={title} subtitle={subtitle} right="›" onPress={() => router.push(path)} />
  );
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{user.full_name}</Text>
        <Muted>@{user.login} · {ROLE_LABEL[user.role]}</Muted>
        <Muted>{mode === 'server' ? `Сервер склада: ${serverUrl}` : 'Автономный режим'}{settings.orgName ? ` · ${settings.orgName}` : ''}</Muted>
      </Card>

      {p.operate || p.takeForSelf ? (
        <Section title="Учёт">
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {link('Документы', 'Приходные и расходные ордера, перемещения', '/documents')}
            {link('История движений', 'Кто, когда, что и откуда взял', '/history')}
            {p.operate ? link('Группы номенклатуры', 'Группы и подгруппы ТМЦ', '/groups') : null}
            {p.operate ? link('Загрузка номенклатуры из Excel', 'Артикул · Название · ШК', { pathname: '/import', params: { kind: 'items' } }) : null}
          </View>
        </Section>
      ) : null}

      {p.operate || p.invite || p.administer ? (
        <Section title="Люди и доступ">
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {p.operate ? link('Сотрудники', 'Роли, отделы, руководители', '/users') : null}
            {p.administer ? link('Отделы', 'Структура подчинённости', '/departments') : null}
            {p.invite ? link('Приглашения', 'Ссылки для подключения сотрудников', '/invites') : null}
          </View>
        </Section>
      ) : null}

      {p.administer || (mode === 'server' && p.invite) ? (
        <Section title="Система">
          <View style={{ borderRadius: 12, overflow: 'hidden' }}>
            {p.administer ? link('Настройки', `Выдача ТМЦ: ${settings.custodyEnabled ? 'включена' : 'выключена'}`, '/settings') : null}
            {mode === 'server' ? link('Подключение терминалов', 'QR-код и адрес сервера для ТСД и телефонов', '/devices') : null}
          </View>
        </Section>
      ) : null}

      <View style={{ height: 16 }} />
      <Button title="Выйти" variant="ghost" onPress={() => confirm('Выход', 'Выйти из аккаунта?', () => logout(), 'Выйти')} />
      {Platform.OS !== 'web' ? (
        <Button title="Сменить сервер / режим" variant="ghost"
          onPress={() => confirm('Сменить подключение?', 'Нужно будет заново выбрать сервер и войти.', () => resetConnection(), 'Сменить')} />
      ) : null}
    </ScrollView>
  );
}
