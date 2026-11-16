import type { ExtractionCandidate, ValidatedExtraction } from './extraction';

/** Lecture d'une page : données structurées et texte nettoyé (EXT-02, étapes 3 et 4). */
export interface PageAnalysis {
  /** JSON-LD `Product`, microdonnées, OpenGraph, dans cet ordre de confiance. */
  readonly structured: ExtractionCandidate;
  /** Texte visible, sans scripts ni styles, tronqué (EXT-34). */
  readonly text: string;
  readonly truncated: boolean;
}

export abstract class PageAnalyzer {
  abstract analyze(html: string, pageUrl: string): PageAnalysis;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type ModelOutcome =
  | { readonly status: 'ok'; readonly candidate: ExtractionCandidate; readonly usage: ModelUsage }
  /** EXT-32 : refus (`stop_reason: refusal`) ou sortie invalide après une nouvelle tentative. */
  | { readonly status: 'refused' | 'invalid'; readonly usage: ModelUsage }
  /** Pas de clé, panne ou plafond du fournisseur. */
  | { readonly status: 'unavailable' };

/**
 * ADR 0007 : le fournisseur de modèle derrière un port. Le contenu est une donnée non fiable
 * (EXT-31) ; aucune donnée personnelle n'est transmise (EXT-33) : ni nom, ni liste, ni identifiant.
 */
export abstract class ProductExtractor {
  abstract fromPageText(text: string): Promise<ModelOutcome>;
  /** Photo déjà réencodée, sans métadonnées (EXT-11). */
  abstract fromPhoto(webp: Buffer): Promise<ModelOutcome>;
}

/** EXT-35 : données publiques d'une page, par URL normalisée, 24 heures. */
export interface CachedExtraction {
  readonly extraction: ValidatedExtraction;
  readonly imageKey: string | null;
  readonly truncated: boolean;
}

export abstract class ExtractionCache {
  abstract get(normalizedUrl: string, now: Date): Promise<CachedExtraction | null>;
  abstract put(input: {
    readonly id: string;
    readonly normalizedUrl: string;
    readonly value: CachedExtraction;
    readonly expiresAt: Date;
  }): Promise<void>;
}

export type ExtractionJob =
  | { readonly kind: 'link'; readonly productId: string; readonly url: string }
  | { readonly kind: 'photo'; readonly productId: string; readonly imageKey: string };

/** ADR 0016 : file dans le processus ; un arrêt brutal laisse au balayage de EXT-06 le soin de conclure. */
export abstract class ExtractionQueue {
  abstract enqueue(job: ExtractionJob): void;
}
