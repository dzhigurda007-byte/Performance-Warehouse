import { deny, isSuperiorOf, need, type Ctx, type SessionUser } from '../ctx';
import { BusinessError, emptyToNull, getMeta, setMeta, type DB } from '../db';
import { can, isRole, rank, ROLE_LABEL, type Role } from '../roles';
import type { Department, Invite, UserRow } from '../types';
import { SETTING_CUSTODY } from './documents';

export function randomToken(len = 24): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(len);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export interface NewUser {
  login: string;
  fullName: string;
  passHash: string;
  salt: string;
}

export interface AuthRow extends SessionUser {
  pass_hash: string;
  salt: string;
  active: number;
}

const USER_SELECT = `
  SELECT u.id, u.login, u.full_name, u.role, u.department_id, d.name AS department_name, u.supervisor_id,
    s.full_name AS supervisor_name, u.position, u.active, u.created_at
  FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users s ON s.id = u.supervisor_id`;

function validateNewUser(u: NewUser) {
  if (!/^[\p{L}\d._-]{3,32}$/u.test(u.login.trim())) {
    throw new BusinessError('Логин: 3–32 символа, буквы, цифры, точка, дефис, подчёркивание');
  }
  if (!u.fullName.trim()) throw new BusinessError('Укажите ФИО — оно попадёт в документы и историю');
}

async function insertUser(db: DB, u: NewUser, role: Role, extra: { department_id?: number | null; supervisor_id?: number | null } = {}) {
  validateNewUser(u);
  const exists = await db.getFirstAsync('SELECT id FROM users WHERE login = ?', u.login.trim());
  if (exists) throw new BusinessError('Пользователь с таким логином уже существует');
  const r = await db.runAsync(`INSERT INTO users(login, full_name, pass_hash, salt, role, department_id, supervisor_id)
    VALUES(?, ?, ?, ?, ?, ?, ?)`,
  u.login.trim(), u.fullName.trim(), u.passHash, u.salt, role, extra.department_id ?? null, extra.supervisor_id ?? null);
  return r.lastInsertRowId;
}

/** Функции авторизации — вызываются без пользователя (до входа). */
export const auth = {
  async userCount(db: DB) {
    return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM users'))?.n ?? 0;
  },

  /** Первый пользователь системы становится администратором. */
  async registerFirstAdmin(db: DB, u: NewUser) {
    if ((await auth.userCount(db)) > 0) throw new BusinessError('Администратор уже создан. Новые сотрудники входят по приглашению.');
    return insertUser(db, u, 'admin');
  },

  /** Автономный режим (база на телефоне): регистрация без приглашений. */
  async registerLocal(db: DB, u: NewUser) {
    const first = (await auth.userCount(db)) === 0;
    return insertUser(db, u, first ? 'admin' : 'storekeeper');
  },

  async inviteInfo(db: DB, token: string) {
    const inv = await db.getFirstAsync<Invite & { expired: number }>(`
      SELECT i.*, (i.expires_at IS NOT NULL AND i.expires_at < datetime('now','localtime')) AS expired, d.name AS department_name, s.full_name AS supervisor_name, c.full_name AS created_by_name
      FROM invites i LEFT JOIN departments d ON d.id = i.department_id LEFT JOIN users s ON s.id = i.supervisor_id
      JOIN users c ON c.id = i.created_by WHERE i.token = ?`, token);
    if (!inv || inv.revoked) throw new BusinessError('Приглашение не найдено или отозвано');
    if (inv.uses >= inv.max_uses) throw new BusinessError('Приглашение уже использовано');
    if (inv.expired) {
      throw new BusinessError('Срок действия приглашения истёк');
    }
    return inv;
  },

  async joinByInvite(db: DB, token: string, u: NewUser) {
    const inv = await auth.inviteInfo(db, token);
    const id = await insertUser(db, u, inv.role, { department_id: inv.department_id, supervisor_id: inv.supervisor_id });
    await db.runAsync('UPDATE invites SET uses = uses + 1 WHERE id = ?', inv.id);
    return id;
  },

  findForLogin: (db: DB, login: string) =>
    db.getFirstAsync<AuthRow>(`SELECT id, login, full_name, role, department_id, supervisor_id, pass_hash, salt, active
      FROM users WHERE login = ?`, login.trim()),

  async createSession(db: DB, userId: number, device?: string) {
    const token = randomToken(40);
    await db.runAsync('INSERT INTO sessions(token, user_id, device) VALUES(?, ?, ?)', token, userId, emptyToNull(device));
    return token;
  },

  async userBySession(db: DB, token: string): Promise<SessionUser | null> {
    const u = await db.getFirstAsync<SessionUser>(`
      SELECT u.id, u.login, u.full_name, u.role, u.department_id, u.supervisor_id
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1`, token);
    if (u) await db.runAsync("UPDATE sessions SET last_seen_at = datetime('now','localtime') WHERE token = ?", token);
    return u;
  },

  dropSession: (db: DB, token: string) => db.runAsync('DELETE FROM sessions WHERE token = ?', token),
};

export interface Settings {
  custodyEnabled: boolean;
  orgName: string;
}

export const users = {
  me: (ctx: Ctx) => ctx.db.getFirstAsync<UserRow>(`${USER_SELECT} WHERE u.id = ?`, ctx.user.id),

  async list(ctx: Ctx) {
    need(ctx, can.operate, 'просмотр сотрудников');
    return ctx.db.getAllAsync<UserRow>(`${USER_SELECT} ORDER BY u.active DESC, u.full_name`);
  },

  /** Кому я могу выдать ТМЦ: себе и тем, чья роль ниже моей. */
  async recipients(ctx: Ctx) {
    const all = await ctx.db.getAllAsync<UserRow>(`${USER_SELECT} WHERE u.active = 1 ORDER BY u.full_name`);
    return all.filter((u) => can.issueTo(ctx.user.role, u.role, u.id === ctx.user.id));
  },

  async update(ctx: Ctx, id: number, p: {
    role?: Role; department_id?: number | null; supervisor_id?: number | null; position?: string; active?: boolean; full_name?: string;
  }) {
    need(ctx, can.manageUsers, 'управление сотрудниками');
    const target = await ctx.db.getFirstAsync<{ role: Role }>('SELECT role FROM users WHERE id = ?', id);
    if (!target) throw new BusinessError('Пользователь не найден');
    const admin = ctx.user.role === 'admin';
    if (!admin) {
      if (rank(target.role) >= rank(ctx.user.role)) deny('изменение пользователя с такой же или более высокой ролью');
      if (p.role && rank(p.role) >= rank(ctx.user.role)) deny(`назначение роли «${ROLE_LABEL[p.role]}»`);
    }
    if (p.role && !isRole(p.role)) throw new BusinessError('Неизвестная роль');
    if (id === ctx.user.id && (p.active === false || (p.role && p.role !== ctx.user.role))) {
      throw new BusinessError('Нельзя понизить или заблокировать самого себя');
    }
    if (p.supervisor_id) {
      if (p.supervisor_id === id) throw new BusinessError('Сотрудник не может быть руководителем сам себе');
      if (await isSuperiorOf(ctx.db, id, p.supervisor_id)) throw new BusinessError('Получится замкнутая цепочка подчинения');
    }
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if (p.role) { sets.push('role = ?'); args.push(p.role); }
    if (p.department_id !== undefined) { sets.push('department_id = ?'); args.push(p.department_id); }
    if (p.supervisor_id !== undefined) { sets.push('supervisor_id = ?'); args.push(p.supervisor_id); }
    if (p.position !== undefined) { sets.push('position = ?'); args.push(emptyToNull(p.position)); }
    if (p.full_name !== undefined && p.full_name.trim()) { sets.push('full_name = ?'); args.push(p.full_name.trim()); }
    if (p.active !== undefined) { sets.push('active = ?'); args.push(p.active ? 1 : 0); }
    if (!sets.length) return;
    await ctx.db.runAsync(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
    if (p.active === false) await ctx.db.runAsync('DELETE FROM sessions WHERE user_id = ?', id);
  },

  // ---------------------------------------------------------------- отделы

  listDepartments: (ctx: Ctx) =>
    ctx.db.getAllAsync<Department>(`
      SELECT d.*, h.full_name AS head_name, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.active = 1) AS members
      FROM departments d LEFT JOIN users h ON h.id = d.head_id ORDER BY d.name`),

  async saveDepartment(ctx: Ctx, d: { id?: number; name: string; parent_id?: number | null; head_id?: number | null }) {
    need(ctx, can.administer, 'управление отделами');
    if (!d.name.trim()) throw new BusinessError('Укажите название отдела');
    if (d.id && d.parent_id === d.id) throw new BusinessError('Отдел не может входить сам в себя');
    try {
      if (d.id) {
        await ctx.db.runAsync('UPDATE departments SET name = ?, parent_id = ?, head_id = ? WHERE id = ?',
          d.name.trim(), d.parent_id ?? null, d.head_id ?? null, d.id);
        return d.id;
      }
      return (await ctx.db.runAsync('INSERT INTO departments(name, parent_id, head_id) VALUES(?, ?, ?)',
        d.name.trim(), d.parent_id ?? null, d.head_id ?? null)).lastInsertRowId;
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new BusinessError('Отдел с таким названием уже есть');
      throw e;
    }
  },

  async deleteDepartment(ctx: Ctx, id: number) {
    need(ctx, can.administer, 'управление отделами');
    await ctx.db.runAsync('DELETE FROM departments WHERE id = ?', id);
  },

  // ---------------------------------------------------------------- приглашения

  async createInvite(ctx: Ctx, p: { role: Role; department_id?: number | null; supervisor_id?: number | null; days?: number; maxUses?: number }) {
    need(ctx, can.invite, 'отправку приглашений');
    if (!isRole(p.role) || !can.inviteRole(ctx.user.role, p.role)) deny(`приглашение с ролью «${ROLE_LABEL[p.role]}»`);
    const token = randomToken(12);
    const days = Math.min(Math.max(p.days ?? 7, 1), 365);
    const r = await ctx.db.runAsync(`INSERT INTO invites(token, role, department_id, supervisor_id, created_by, expires_at, max_uses)
      VALUES(?, ?, ?, ?, ?, datetime('now','localtime', ?), ?)`,
    token, p.role, p.department_id ?? ctx.user.department_id, p.supervisor_id ?? ctx.user.id, ctx.user.id,
    `+${days} days`, Math.min(Math.max(p.maxUses ?? 1, 1), 500));
    return { id: r.lastInsertRowId, token };
  },

  async listInvites(ctx: Ctx) {
    need(ctx, can.invite, 'просмотр приглашений');
    const mineOnly = ctx.user.role !== 'admin';
    return ctx.db.getAllAsync<Invite>(`
      SELECT i.*, d.name AS department_name, s.full_name AS supervisor_name, c.full_name AS created_by_name
      FROM invites i LEFT JOIN departments d ON d.id = i.department_id LEFT JOIN users s ON s.id = i.supervisor_id
      JOIN users c ON c.id = i.created_by ${mineOnly ? 'WHERE i.created_by = ?' : ''} ORDER BY i.id DESC LIMIT 200`,
    ...(mineOnly ? [ctx.user.id] : []));
  },

  async revokeInvite(ctx: Ctx, id: number) {
    need(ctx, can.invite);
    const inv = await ctx.db.getFirstAsync<{ created_by: number }>('SELECT created_by FROM invites WHERE id = ?', id);
    if (!inv) return;
    if (ctx.user.role !== 'admin' && inv.created_by !== ctx.user.id) deny('отзыв чужого приглашения');
    await ctx.db.runAsync('UPDATE invites SET revoked = 1 WHERE id = ?', id);
  },

  // ---------------------------------------------------------------- настройки

  async settings(ctx: Ctx): Promise<Settings> {
    return {
      custodyEnabled: (await getMeta(ctx.db, SETTING_CUSTODY)) === '1',
      orgName: (await getMeta(ctx.db, 'org_name')) ?? '',
    };
  },

  async saveSettings(ctx: Ctx, s: Partial<Settings>) {
    need(ctx, can.administer, 'изменение настроек');
    if (s.custodyEnabled !== undefined) await setMeta(ctx.db, SETTING_CUSTODY, s.custodyEnabled ? '1' : '0');
    if (s.orgName !== undefined) await setMeta(ctx.db, 'org_name', s.orgName.trim());
  },
};
