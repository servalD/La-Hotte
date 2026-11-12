import { buildCsp } from './middleware';

describe('CSP (SEC-13)', () => {
  const prod = buildCsp('abc123', false);

  it('scripts par nonce, sans unsafe-inline ni unsafe-eval en production', () => {
    const scriptSrc = prod.split('; ').find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it('interdit l’affichage dans un cadre et les objets', () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
  });

  it('n’autorise eval qu’en développement', () => {
    expect(buildCsp('n', true)).toContain("'unsafe-eval'");
  });
});
