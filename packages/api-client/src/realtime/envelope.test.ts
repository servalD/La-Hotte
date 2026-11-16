import { describe, expect, it } from 'vitest';
import { parseRealtimeEvent, realtimeEventSchemas } from './events';

describe('événements temps réel (API-32, API-33, RT-08)', () => {
  const valid = {
    type: 'comment.created',
    room: 'item:0190f3c2-0000-7000-8000-000000000001:public',
    at: '2026-11-12T10:00:00.000Z',
    data: {
      itemId: '0190f3c2-0000-7000-8000-000000000001',
      thread: 'PUBLIC',
      commentId: '0190f3c2-0000-7000-8000-000000000002',
    },
  };

  it('accepte un événement conforme', () => {
    expect(realtimeEventSchemas['comment.created'].parse(valid)).toEqual(valid);
    expect(parseRealtimeEvent(valid)).toEqual(valid);
  });

  it('refuse un champ inattendu (aucun contenu ni champ d’offreur glissé dans les données)', () => {
    expect(parseRealtimeEvent({ ...valid, data: { ...valid.data, body: 'Je prends' } })).toBeNull();
    expect(parseRealtimeEvent({ ...valid, buyer: 'x' })).toBeNull();
  });

  it('ignore un type inconnu', () => {
    expect(parseRealtimeEvent({ ...valid, type: 'contribution.changed' })).toBeNull();
  });

  it('seq seulement entier positif', () => {
    const notification = {
      type: 'notification.created',
      room: 'profile:0190f3c2-0000-7000-8000-000000000003',
      at: valid.at,
      seq: 4,
      data: { notificationId: '0190f3c2-0000-7000-8000-000000000004', seq: 4 },
    };
    expect(parseRealtimeEvent(notification)).toEqual(notification);
    expect(parseRealtimeEvent({ ...notification, seq: -1 })).toBeNull();
  });
});
