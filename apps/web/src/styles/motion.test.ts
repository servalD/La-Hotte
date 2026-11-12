import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { duration, ease } from './motion';

// MOT-02 : une seule source de vérité ; motion.ts et tokens.css ne divergent jamais.
const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('[data-theme='));

function cssVar(name: string): string {
  const match = new RegExp(`--ds-${name}:\\s*([^;]+);`).exec(rootBlock);
  if (!match?.[1]) throw new Error(`Variable --ds-${name} absente`);
  return match[1].trim();
}

describe('jetons de mouvement (MOT-01, MOT-02)', () => {
  it.each(Object.entries(duration))('durée %s identique en CSS et en TS', (name, seconds) => {
    expect(cssVar(`duration-${name}`)).toBe(`${String(Math.round(seconds * 1000))}ms`);
  });

  it.each(Object.entries(ease))('courbe %s identique en CSS et en TS', (name, points) => {
    expect(cssVar(`ease-${name}`)).toBe(`cubic-bezier(${points.join(', ')})`);
  });

  it('MOT-01 : rien au-dessus de 500 ms sauf la célébration', () => {
    const { celebration: _celebration, ...others } = duration;
    for (const value of Object.values(others)) expect(value).toBeLessThanOrEqual(0.5);
  });
});
