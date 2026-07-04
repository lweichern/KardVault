// Tiered identification waterfall (CLAUDE-enhance.md §2).
// Tiers run in order and stop at the first confident result:
//   1. Perceptual hash NN (local, ~ms, free)
//   2. OCR on the identifier strip → deterministic catalog lookup
//   3. Gemini structured EXTRACTION (never identification) → fuzzy catalog match
//   4. Human confirm UI — always the safety net; never silently insert
//      a low-confidence match.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Card, CatalogProvider, ParsedId } from "@/lib/catalog";
import type { OcrProvider } from "@/lib/ocr";
import type { VisionProvider } from "@/lib/vision/types";
import type { HashHit } from "./hash-index";

// Tier 1 thresholds (64-bit pHash) — tuned via scan_events telemetry.
// Real phone captures of the correct card score distance 10–14 (spec's
// starting value of 10 was calibrated on clean catalog images and rejected
// true matches); the margin rule still guards against same-art reprints.
export const T_ACCEPT = 14;
export const T_MARGIN = 6;
/** Art-hash agreement slack: art crops tolerate a little more noise. */
export const T_ART_ACCEPT = 18;

const PRIOR_K = 5;
const MAX_CANDIDATES = 3;

export interface ScanInput {
  /** Warped full-card crop, base64 JPEG. */
  imageFull: string;
  /** Zoomed identifier-strip crop, base64 JPEG. */
  imageStrip?: string;
  /** Client-computed pHashes of the warped crop (16 hex chars). */
  hashFull?: string;
  hashArt?: string;
}

export interface WaterfallTelemetry {
  hashBestDistance: number | null;
  hashMargin: number | null;
  ocrParsed: boolean;
  geminiCalled: boolean;
}

export interface WaterfallResult {
  card: Card | null; // auto-accepted card, or best suggestion
  candidates: Card[]; // top ≤3 for the Tier 4 confirm UI
  autoAccepted: boolean;
  tierResolved: 1 | 2 | 3 | 4 | null;
  telemetry: WaterfallTelemetry;
}

export interface WaterfallDeps {
  catalog: CatalogProvider;
  db: SupabaseClient<Database>;
  /** Tier 1 k-NN. Null disables the tier (no hash index yet). */
  hashSearch:
    | ((hashFull: string, hashArt: string | null, k: number) => Promise<HashHit[]>)
    | null;
  /** Tier 2 OCR. Null disables the tier (no key configured). */
  ocr: OcrProvider | null;
  /** Tier 3 extraction. Null disables the tier. */
  vision: VisionProvider | null;
  getCardsByIds: (ids: string[]) => Promise<Card[]>;
}

function parsedFromExtraction(
  catalog: CatalogProvider,
  collectorNumber: string | null,
  setTotal: string | null
): ParsedId | null {
  if (!collectorNumber) return null;
  const composite =
    setTotal && !collectorNumber.includes("/")
      ? `${collectorNumber}/${setTotal}`
      : collectorNumber;
  return catalog.parseIdentifier(composite);
}

export async function runWaterfall(
  input: ScanInput,
  deps: WaterfallDeps
): Promise<WaterfallResult> {
  const telemetry: WaterfallTelemetry = {
    hashBestDistance: null,
    hashMargin: null,
    ocrParsed: false,
    geminiCalled: false,
  };

  const finish = async (
    card: Card | null,
    candidateIds: string[],
    autoAccepted: boolean,
    tierResolved: WaterfallResult["tierResolved"],
    prefetched: Map<string, Card>
  ): Promise<WaterfallResult> => {
    const ids = candidateIds.filter((id, i) => candidateIds.indexOf(id) === i).slice(0, MAX_CANDIDATES);
    const missing = ids.filter((id) => !prefetched.has(id));
    if (missing.length > 0) {
      for (const c of await deps.getCardsByIds(missing)) prefetched.set(c.id, c);
    }
    const candidates = ids
      .map((id) => prefetched.get(id))
      .filter((c): c is Card => !!c);
    return { card, candidates, autoAccepted, tierResolved, telemetry };
  };

  const known = new Map<string, Card>();

  // ── Tier 1: perceptual hash ────────────────────────────────────────────────
  let priors: HashHit[] = [];
  if (deps.hashSearch && input.hashFull) {
    try {
      priors = await deps.hashSearch(input.hashFull, input.hashArt ?? null, PRIOR_K);
    } catch (err) {
      console.error("[waterfall] tier1 failed:", err);
      priors = [];
    }
    if (priors.length > 0) {
      const best = priors[0];
      const margin = priors.length > 1 ? priors[1].distance - best.distance : 64;
      telemetry.hashBestDistance = best.distance;
      telemetry.hashMargin = margin;

      const artAgrees = best.artDistance === null || best.artDistance <= T_ART_ACCEPT;
      if (best.distance <= T_ACCEPT && margin >= T_MARGIN && artAgrees) {
        const [card] = await deps.getCardsByIds([best.cardId]);
        if (card) {
          known.set(card.id, card);
          return finish(
            card,
            priors.slice(0, MAX_CANDIDATES).map((h) => h.cardId),
            true,
            1,
            known
          );
        }
      }
    }
  }
  const priorIds = priors.map((p) => p.cardId);

  // ── Tier 2: OCR on the identifier strip ───────────────────────────────────
  let ocrMatches: Card[] = [];
  if (deps.ocr && input.imageStrip) {
    try {
      const text = await deps.ocr.readText(input.imageStrip);
      const parsed = text ? deps.catalog.parseIdentifier(text) : null;
      telemetry.ocrParsed = !!parsed;
      if (parsed) {
        ocrMatches = await deps.catalog.lookup(parsed, deps.db);
        for (const c of ocrMatches) known.set(c.id, c);

        if (ocrMatches.length > 0) {
          const top = ocrMatches[0];
          if (priorIds.length > 0 && priorIds[0] === top.id) {
            // Tier 1 + Tier 2 agree → highest confidence
            return finish(top, [top.id, ...priorIds], true, 2, known);
          }
          if (priorIds.length === 0 && ocrMatches.length === 1) {
            // Hash tier skipped/failed but the identifier is a unique match
            return finish(top, [top.id], true, 2, known);
          }
        }
      }
    } catch (err) {
      console.error("[waterfall] tier2 failed:", err);
    }
  }

  // ── Tier 3: structured extraction (only when cheap tiers can't agree) ─────
  let fuzzyMatches: Card[] = [];
  if (deps.vision) {
    try {
      telemetry.geminiCalled = true;
      const images = input.imageStrip
        ? [input.imageFull, input.imageStrip]
        : [input.imageFull];
      const extraction = await deps.vision.extract(images);

      const parsed = parsedFromExtraction(
        deps.catalog,
        extraction.collector_number,
        extraction.set_total
      );
      fuzzyMatches = await deps.catalog.fuzzyLookup(
        {
          name: extraction.card_name,
          number: parsed?.number ?? extraction.collector_number,
          setTotal: parsed?.setTotal ?? null,
        },
        deps.db
      );
      for (const c of fuzzyMatches) known.set(c.id, c);

      if (fuzzyMatches.length > 0) {
        const top = fuzzyMatches[0];
        // Agreement between independent signals — never Gemini confidence alone:
        //   name  — extraction name led the fuzzy match
        //   number — parsed identifier matches the top card's catalog number
        //   prior — Tier 1 hash NN pointed at the same card
        //   ocr   — Tier 2 lookup found the same card
        let signals = 0;
        if (extraction.card_name) signals++;
        if (
          parsed?.number &&
          top.number &&
          top.number.toUpperCase().replace(/^0+(\d)/, "$1") ===
            parsed.number.toUpperCase().replace(/^0+(\d)/, "$1")
        ) {
          signals++;
        }
        if (priorIds.includes(top.id)) signals++;
        if (ocrMatches.some((c) => c.id === top.id)) signals++;

        if (signals >= 2) {
          return finish(
            top,
            [top.id, ...fuzzyMatches.slice(1).map((c) => c.id), ...priorIds],
            true,
            3,
            known
          );
        }
      }
    } catch (err) {
      console.error("[waterfall] tier3 failed:", err);
    }
  }

  // ── Tier 4: human confirm — best suggestions, no silent insert ────────────
  const candidateIds = [
    ...fuzzyMatches.map((c) => c.id),
    ...ocrMatches.map((c) => c.id),
    ...priorIds,
  ];
  const hasCandidates = candidateIds.length > 0;
  const result = await finish(null, candidateIds, false, hasCandidates ? 4 : null, known);
  // Surface the top suggestion (UI still requires a tap to confirm)
  return { ...result, card: result.candidates[0] ?? null };
}
