import { render, screen } from '@testing-library/react';
import { QrCode } from './qr-code';

describe('QrCode', () => {
  it('dessine une image annoncée aux lecteurs d’écran, sans HTML injecté', () => {
    const { container } = render(
      <QrCode
        value="otpauth://totp/La%20Hotte:a@b.c?secret=ABC&issuer=La%20Hotte"
        label="QR code"
      />,
    );
    const svg = screen.getByRole('img', { name: 'QR code' });
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 (\d+) \1$/);
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});
