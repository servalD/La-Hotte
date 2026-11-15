import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCandidate, type ValidatedExtraction } from '../domain/extraction';
import { HtmlPageAnalyzer } from './html-page-analyzer';

// ADR 0007, `14` : jeu de pages figées et taux de champs corrects des données structurées (sans
// modèle ni réseau). Une page ajoutée à `test/fixtures/pages` avec sa ligne dans `expected.json`
// entre seule dans la mesure. Les pages sans données structurées (`needsModel`) mesurent ce qui
// reste au modèle ; la page piégée vérifie que rien du piège ne passe la validation (EXT-31).

const DIR = join(__dirname, '../../../../test/fixtures/pages');
const FIELDS = ['title', 'unitPriceMinor', 'currency', 'merchant', 'imageUrl'] as const;
type Field = (typeof FIELDS)[number];

interface Expected extends Record<Field, string | number | null> {
  url: string;
  needsModel?: boolean;
  trap?: boolean;
}

const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as Record<
  string,
  Expected
>;
const analyzer = new HtmlPageAnalyzer();

function extract(file: string, url: string): ValidatedExtraction {
  return validateCandidate(analyzer.analyze(readFileSync(join(DIR, file), 'utf8'), url).structured);
}

describe('Pages figées : mesure de l’extraction par données structurées', () => {
  it('chaque page a ses attentes, et inversement', () => {
    const pages = readdirSync(DIR)
      .filter((f) => f.endsWith('.html'))
      .sort();
    expect(pages).toEqual(Object.keys(expected).sort());
  });

  it('taux de champs corrects par champ (pages à données structurées)', () => {
    const counts = Object.fromEntries(FIELDS.map((f) => [f, { ok: 0, total: 0 }])) as Record<
      Field,
      { ok: number; total: number }
    >;
    const misses: string[] = [];
    for (const [file, want] of Object.entries(expected)) {
      if (want.needsModel || want.trap) continue;
      const got = extract(file, want.url);
      for (const field of FIELDS) {
        counts[field].total += 1;
        if (got[field] === want[field]) counts[field].ok += 1;
        else misses.push(`${file} ${field} : ${String(got[field])} ≠ ${String(want[field])}`);
      }
    }
    const report = FIELDS.map(
      (f) =>
        `${f.padEnd(15)} ${counts[f].ok}/${counts[f].total} (${Math.round((100 * counts[f].ok) / counts[f].total)} %)`,
    ).join('\n');
    // Affiché par Vitest : le suivi de la qualité (OBS, `14`).
    console.info(`Extraction structurée, pages figées :\n${report}`);
    expect(misses).toEqual([]);
  });

  it('page sans données structurées : tout reste au modèle', () => {
    const got = extract('sans-donnees.html', expected['sans-donnees.html']!.url);
    expect(got.title).toBeNull();
    expect(got.unitPriceMinor).toBeNull();
  });

  it('EXT-31, critère de 02 : la page piégée donne une fiche incomplète, jamais un prix à 0 ni une image http', () => {
    const want = expected['piegee.html']!;
    const got = extract('piegee.html', want.url);
    expect(got.title).toBe(want.title);
    expect(got.unitPriceMinor).toBeNull();
    expect(got.imageUrl).toBeNull();
    expect(new Set(got.uncertainFields)).toEqual(new Set(['price', 'image']));
  });
});
