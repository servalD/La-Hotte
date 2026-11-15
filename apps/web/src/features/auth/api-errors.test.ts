import { ApiError } from '@wishlist/api-client';
import { describe, expect, it } from 'vitest';
import { authErrorKey, isPasswordError } from './api-errors';

const problem = (code: string, status: number) =>
  new ApiError({ type: 'x', title: 'x', status, code });

describe('authErrorKey', () => {
  it('reconnaît un code connu', () => {
    expect(authErrorKey(problem('INVALID_CREDENTIALS', 401))).toBe('INVALID_CREDENTIALS');
  });
  it('traite tout 429 comme une limitation', () => {
    expect(authErrorKey(problem('AUTRE', 429))).toBe('RATE_LIMITED');
  });
  it('retombe sur un message générique, sans reprendre le texte du serveur', () => {
    expect(authErrorKey(problem('INCONNU', 500))).toBe('generic');
  });
  it('distingue une panne réseau', () => {
    expect(authErrorKey(new TypeError('fetch failed'))).toBe('network');
  });
  it('repère une erreur de mot de passe', () => {
    expect(isPasswordError(problem('PASSWORD_BREACHED', 422))).toBe(true);
    expect(isPasswordError(problem('INVALID_CREDENTIALS', 401))).toBe(false);
  });
});
