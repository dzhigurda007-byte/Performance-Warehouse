import type { SessionUser } from '../core/ctx';
import { BusinessError, type DB } from '../core/db';

/** В браузере автономный режим не используется: веб-версия всегда работает через сервер склада. */
export async function openLocalDb(): Promise<DB> {
  throw new BusinessError('Автономный режим доступен только в приложении на телефоне');
}

export const localAuth = {
  register: async (): Promise<SessionUser> => openLocalDb() as never,
  login: async (): Promise<SessionUser> => openLocalDb() as never,
  byId: async (): Promise<SessionUser | null> => null,
};
