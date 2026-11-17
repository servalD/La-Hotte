import { describe, expect, it } from 'vitest';
import {
  hasPlatformPermission,
  PLATFORM_PERMISSIONS,
  type PlatformPermission,
} from './platform-permissions';
import type { AccountRole } from './session';

// RBAC-02 : recopie du tableau de `docs/spec/11-admin-rbac.md`. Une ligne changée ici doit l'être
// d'abord dans la spec.
const TABLE: Record<PlatformPermission, Record<AccountRole, boolean>> = {
  'moderation.queue': { USER: false, MODERATOR: true, ADMIN: true },
  'moderation.decide': { USER: false, MODERATOR: true, ADMIN: true },
  'stats.read': { USER: false, MODERATOR: true, ADMIN: true },
  'accounts.search': { USER: false, MODERATOR: false, ADMIN: true },
  'accounts.manage': { USER: false, MODERATOR: false, ADMIN: true },
  'roles.manage': { USER: false, MODERATOR: false, ADMIN: true },
  'audit.read': { USER: false, MODERATOR: false, ADMIN: true },
  'settings.manage': { USER: false, MODERATOR: false, ADMIN: true },
};

describe('Permissions de plateforme (RBAC-02, RBAC-04)', () => {
  it('le tableau couvre toutes les permissions', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...PLATFORM_PERMISSIONS].sort());
  });

  for (const permission of PLATFORM_PERMISSIONS) {
    for (const role of ['USER', 'MODERATOR', 'ADMIN'] as const) {
      it(`${role} ${TABLE[permission][role] ? 'a' : 'n’a pas'} ${permission}`, () => {
        expect(hasPlatformPermission(role, permission)).toBe(TABLE[permission][role]);
      });
    }
  }

  it('refuse un rôle inconnu (refus par défaut)', () => {
    expect(hasPlatformPermission('ROOT' as AccountRole, 'audit.read')).toBe(false);
  });
});
