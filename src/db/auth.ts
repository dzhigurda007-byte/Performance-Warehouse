import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { User } from '../domain/types';
import { BusinessError, getMeta, setMeta } from './repo';

const SESSION_KEY = 'session_user_id';

async function hash(password: string, salt: string) {
  // Простое растяжение ключа: многократный SHA-256 с солью.
  let h = `${salt}:${password}`;
  for (let i = 0; i < 300; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}${h}`);
  }
  return h;
}

export async function register(db: SQLiteDatabase, login: string, fullName: string, password: string): Promise<User> {
  const l = login.trim();
  if (!/^[\p{L}\d._-]{3,32}$/u.test(l)) {
    throw new BusinessError('Логин: 3–32 символа, буквы, цифры, точка, дефис, подчёркивание');
  }
  if (!fullName.trim()) throw new BusinessError('Укажите ФИО — оно попадёт в документы и историю');
  if (password.length < 4) throw new BusinessError('Пароль должен быть не короче 4 символов');
  const exists = await db.getFirstAsync('SELECT id FROM users WHERE login = ?', l);
  if (exists) throw new BusinessError('Пользователь с таким логином уже существует');
  const salt = Crypto.randomUUID();
  const r = await db.runAsync('INSERT INTO users(login, full_name, pass_hash, salt) VALUES(?, ?, ?, ?)',
    l, fullName.trim(), await hash(password, salt), salt);
  const user = { id: r.lastInsertRowId, login: l, full_name: fullName.trim() };
  await setMeta(db, SESSION_KEY, String(user.id));
  return user;
}

export async function login(db: SQLiteDatabase, login: string, password: string): Promise<User> {
  const row = await db.getFirstAsync<User & { pass_hash: string; salt: string }>(
    'SELECT * FROM users WHERE login = ?', login.trim());
  if (!row || (await hash(password, row.salt)) !== row.pass_hash) {
    throw new BusinessError('Неверный логин или пароль');
  }
  await setMeta(db, SESSION_KEY, String(row.id));
  return { id: row.id, login: row.login, full_name: row.full_name };
}

export async function logout(db: SQLiteDatabase) {
  await setMeta(db, SESSION_KEY, null);
}

export async function restoreSession(db: SQLiteDatabase): Promise<User | null> {
  const id = await getMeta(db, SESSION_KEY);
  if (!id) return null;
  return db.getFirstAsync<User>('SELECT id, login, full_name FROM users WHERE id = ?', Number(id));
}
