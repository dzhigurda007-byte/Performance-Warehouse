import { router } from 'expo-router';
import type { Resolved } from '../core/services/history';

/** Открыть карточку того, что отсканировано. */
export function openScanned(r: Resolved) {
  switch (r.type) {
    case 'rack':
      return router.push({ pathname: '/rack/[id]', params: { id: String(r.rack.id) } });
    case 'cell':
      return router.push({ pathname: '/cell/[id]', params: { id: String(r.cell.id) } });
    case 'box':
      return router.push({ pathname: '/box/[id]', params: { id: String(r.box.id) } });
    case 'item':
      return router.push({ pathname: '/item/[id]', params: { id: String(r.item.id) } });
    case 'custody':
      return router.push({ pathname: '/custody/[id]', params: { id: String(r.custody.id) } });
    case 'invite':
      return router.push({ pathname: '/join/[token]', params: { token: r.token, server: r.server } });
    default:
      return undefined;
  }
}
