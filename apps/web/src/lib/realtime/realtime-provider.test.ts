import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { applyRealtimeEvent } from './realtime-provider';

// RT-07, RT-08 : une trame invalide les lectures qui mentionnent ses identifiants ; `access.revoked`
// purge celles du salon quitté.

const ITEM = '0190f3c2-0000-7000-8000-000000000001';
const LIST = '0190f3c2-0000-7000-8000-000000000002';

describe('applyRealtimeEvent', () => {
  it('invalide ce qui mentionne l’élément ; purge à la perte d’accès', () => {
    const client = new QueryClient();
    client.setQueryData(['/api/v1/items', ITEM, 'comments'], { items: [] });
    client.setQueryData(['/api/v1/lists', LIST], { id: LIST });
    applyRealtimeEvent(client, {
      type: 'comment.created',
      room: `item:${ITEM}:public`,
      at: '2026-11-16T10:00:00.000Z',
      data: { itemId: ITEM, thread: 'PUBLIC', commentId: ITEM },
    });
    expect(client.getQueryState(['/api/v1/items', ITEM, 'comments'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['/api/v1/lists', LIST])?.isInvalidated).toBe(false);

    applyRealtimeEvent(client, {
      type: 'access.revoked',
      room: 'profile:x',
      at: '2026-11-16T10:00:00.000Z',
      data: { room: `list:${LIST}` },
    });
    expect(client.getQueryData(['/api/v1/lists', LIST])).toBeUndefined();
  });
});
