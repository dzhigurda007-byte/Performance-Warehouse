import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { loadSessionUser, type SessionUser } from '../core/ctx';
import { BusinessError, type DB } from '../core/db';
import { migrate } from '../core/schema';
import { auth } from '../core/services/users';

/** Автономный режим: база на самом телефоне (как в первой версии приложения). */
export async function openLocalDb(): Promise<DB> {
  const db = (await SQLite.openDatabaseAsync('warehouse.db')) as unknown as DB;
  await migrate(db);
  return db;
}

async function hash(password: string, salt: string) {
  // Многократный SHA-256 с солью (совместимо с аккаунтами первой версии).
  let h = `${salt}:${password}`;
  for (let i = 0; i < 300; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}${h}`);
  }
  return h;
}

export const localAuth = {
  async register(db: DB, login: string, fullName: string, password: string): Promise<SessionUser> {
    if (password.length < 4) throw new BusinessError('Пароль должен быть не короче 4 символов');
    const salt = Crypto.randomUUID();
    const id = await auth.registerLocal(db, { login, fullName, passHash: await hash(password, salt), salt });
    return (await loadSessionUser(db, id))!;
  },
  async login(db: DB, login: string, password: string): Promise<SessionUser> {
    const row = await auth.findForLogin(db, login);
    if (!row || !row.active || (await hash(password, row.salt)) !== row.pass_hash) {
      throw new BusinessError('Неверный логин или пароль');
    }
    return (await loadSessionUser(db, row.id))!;
  },
  byId: loadSessionUser,
};
