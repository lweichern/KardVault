// Sealed-product matching for Snap & Sell (CLAUDE-enhance.md §5).
// Gemini returns a name guess per detected item ("Surging Sparks Elite
// Trainer Box"); we match it against tcg_products (is_sealed) with
// IDF-weighted token scoring:
//   - rare tokens (set names: "surging", "sparks") dominate common ones
//     (series names: "scarlet", "violet") — measured failure without this
//   - products with extra unmatched tokens ("... Case", "(Exclusive)") are
//     penalized so the plain variant outranks them
//   - product-type and language mismatches gate hard: booster box vs bundle
//     vs ETB and EN vs JP have wildly different prices

export interface SealedProduct {
  productId: number;
  name: string;
  imageUrl: string | null;
  groupName?: string | null;
}

export interface SealedMatch {
  product: SealedProduct;
  score: number;
}

export interface SealedCatalogIndex {
  entries: { product: SealedProduct; tokens: string[] }[];
  /** token → inverse document frequency across the sealed catalog */
  idf: Map<string, number>;
  defaultIdf: number;
}

/** Product-type vocabulary — mismatches here are price-breaking. */
const TYPE_TOKENS = new Map<string, string>([
  ["booster", "booster"],
  ["box", "box"],
  ["bundle", "bundle"],
  ["elite", "etb"],
  ["trainer", "etb"],
  ["etb", "etb"],
  ["tin", "tin"],
  ["collection", "collection"],
  ["blister", "blister"],
  ["pack", "pack"],
  ["display", "box"],
  ["premium", "premium"],
  ["ultra", "ultra"],
]);

const JP_HINTS = ["japanese", "japan", "jp", "jpn"];

export function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 || /\d/.test(t));
}

function typeSignature(tokens: string[]): Set<string> {
  const sig = new Set<string>();
  for (const t of tokens) {
    const mapped = TYPE_TOKENS.get(t);
    if (mapped) sig.add(mapped);
  }
  return sig;
}

function isJapanese(tokens: string[]): boolean {
  return tokens.some((t) => JP_HINTS.includes(t));
}

/**
 * Score a Gemini label against a product's tokens. 0..1.
 * IDF-weighted label coverage carries the base score; product-side coverage
 * penalizes variant suffixes; type + language agreement gate the result.
 */
export function scoreMatch(
  labelTokens: string[],
  productTokens: string[],
  idf?: Map<string, number>,
  defaultIdf = 1
): number {
  if (labelTokens.length === 0 || productTokens.length === 0) return 0;

  const weight = (t: string) => idf?.get(t) ?? defaultIdf;
  const productSet = new Set(productTokens);
  const overlap = labelTokens.filter((t) => productSet.has(t));
  if (overlap.length === 0) return 0;

  const wOverlap = overlap.reduce((s, t) => s + weight(t), 0);
  const wLabel = labelTokens.reduce((s, t) => s + weight(t), 0);
  const labelCoverage = wOverlap / Math.max(wLabel, 1e-9);

  // Penalize products with many tokens the label never mentioned
  // ("… Case", "(Exclusive)", "Bulk") so the plain variant ranks first.
  const productCoverage = overlap.length / productTokens.length;
  let base = labelCoverage * (0.7 + 0.3 * productCoverage);

  const labelTypes = typeSignature(labelTokens);
  const productTypes = typeSignature(productTokens);
  if (labelTypes.size > 0 && productTypes.size > 0) {
    const shared = [...labelTypes].filter((t) => productTypes.has(t)).length;
    if (shared === 0) return base * 0.25;
    const union = new Set([...labelTypes, ...productTypes]).size;
    base += (shared / union) * 0.15;
  }

  // Language: JP label must not match EN product silently and vice versa
  if (isJapanese(labelTokens) !== isJapanese(productTokens)) {
    return base * 0.4;
  }

  // Unclamped — scores are only compared against each other and the 0.2 floor
  return base;
}

/** Top-k sealed products for a Gemini label. */
export function matchSealedProducts(
  label: string,
  index: SealedCatalogIndex,
  k = 3
): SealedMatch[] {
  const labelTokens = tokenize(label);
  const scored: SealedMatch[] = [];
  for (const entry of index.entries) {
    const score = scoreMatch(labelTokens, entry.tokens, index.idf, index.defaultIdf);
    if (score > 0.2) scored.push({ product: entry.product, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Pre-tokenize the sealed catalog and compute token IDF (cached by callers). */
export function buildSealedCatalogIndex(products: SealedProduct[]): SealedCatalogIndex {
  const entries = products.map((product) => ({
    product,
    tokens: [
      ...new Set([...tokenize(product.name), ...tokenize(product.groupName ?? "")]),
    ],
  }));

  const df = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(entries.length, 1);
  const idf = new Map<string, number>();
  for (const [t, count] of df) {
    idf.set(t, Math.log(1 + n / count));
  }
  // Unseen tokens (typos, flavor words) get a middling weight
  const defaultIdf = Math.log(1 + n / Math.max(1, Math.sqrt(n)));

  return { entries, idf, defaultIdf };
}
