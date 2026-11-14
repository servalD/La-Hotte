import { describe, expect, it } from 'vitest';
import { safeAuthorizationUrl } from './authorization-url';

describe('safeAuthorizationUrl', () => {
  it('accepte Google en https', () => {
    expect(safeAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).not.toBeNull();
  });
  it('accepte un fournisseur local en développement', () => {
    expect(safeAuthorizationUrl('http://localhost:9000/auth')).not.toBeNull();
  });
  it.each([
    'https://accounts.google.com.evil.example/auth',
    'http://accounts.google.com/auth',
    'https://evil.example/auth',
    'javascript:alert(1)',
    '//evil.example',
    'pas une url',
  ])('refuse %s', (value) => {
    expect(safeAuthorizationUrl(value)).toBeNull();
  });
});
