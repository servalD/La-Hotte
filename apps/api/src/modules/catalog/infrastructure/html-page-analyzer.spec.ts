import { PAGE_TEXT_MAX_CHARS } from '../domain/extraction';
import { HtmlPageAnalyzer } from './html-page-analyzer';

// EXT-02, étapes 3 et 4 ; EXT-34 (troncature).

const analyzer = new HtmlPageAnalyzer();
const URL = 'https://shop.example/velo';

describe('HtmlPageAnalyzer', () => {
  it('JSON-LD Product dans un @graph, offre en tableau, image relative', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Boutique' },
        {
          '@type': ['Product'],
          name: 'Vélo rouge',
          description: 'Un vélo',
          image: ['/img/velo.jpg'],
          offers: [
            {
              '@type': 'Offer',
              price: '199.99',
              priceCurrency: 'EUR',
              seller: { name: 'Vélos & Co' },
            },
          ],
        },
      ],
    })}</script></head><body><h1>Vélo</h1></body></html>`;
    expect(analyzer.analyze(html, URL).structured).toEqual({
      title: 'Vélo rouge',
      description: 'Un vélo',
      price: '199.99',
      currency: 'EUR',
      merchant: 'Vélos & Co',
      imageUrl: 'https://shop.example/img/velo.jpg',
      lowConfidence: [],
    });
  });

  it('microdonnées puis OpenGraph en repli ; JSON-LD illisible ignoré', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ pas du json</script>
      <meta property="og:title" content="Titre OG">
      <meta property="og:image" content="https://cdn.example/og.jpg">
      <meta property="og:site_name" content="Boutique OG">
      </head><body>
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Lampe</span>
        <meta itemprop="price" content="49,90"><meta itemprop="priceCurrency" content="EUR">
      </div></body></html>`;
    expect(analyzer.analyze(html, URL).structured).toMatchObject({
      title: 'Lampe',
      price: '49,90',
      currency: 'EUR',
      merchant: 'Boutique OG',
      imageUrl: 'https://cdn.example/og.jpg',
    });
  });

  it('texte visible seulement (ni script, ni style), tronqué au-delà de la taille fixe', () => {
    const html = `<html><head><title>Page</title><style>.x{}</style></head><body>
      <script>window.secret = "marqueur-script"</script>
      <p>${'mot '.repeat(10_000)}</p></body></html>`;
    const analysis = analyzer.analyze(html, URL);
    expect(analysis.text).not.toContain('marqueur-script');
    expect(analysis.text).not.toContain('.x{}');
    expect(analysis.text.startsWith('Page')).toBe(true);
    expect(analysis.text.length).toBe(PAGE_TEXT_MAX_CHARS);
    expect(analysis.truncated).toBe(true);
  });
});
