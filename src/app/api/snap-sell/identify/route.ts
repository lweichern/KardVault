import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { detectSealedProducts } from "@/lib/snapsell/detect";
import {
  buildSealedCatalogIndex,
  matchSealedProducts,
  type SealedProduct,
} from "@/lib/snapsell/match";
import type { Database } from "@/types/database";

// Snap & Sell identification (CLAUDE-enhance.md §5): one flat-lay photo →
// Gemini bounding boxes → deterministic sealed-catalog matching → prices
// pre-filled from tcg_prices in MYR. The confirm screen is mandatory
// client-side; nothing here is auto-posted.

export interface SnapSellCandidate {
  productId: number;
  name: string;
  imageUrl: string | null;
  marketUsd: number | null;
  priceMyr: number | null;
}

export interface SnapSellItem {
  box: { x: number; y: number; w: number; h: number };
  label: string;
  candidates: SnapSellCandidate[];
}

// ── Module caches (per serverless instance) ─────────────────────────────────

let catalogCache: {
  index: ReturnType<typeof buildSealedCatalogIndex>;
  loadedAt: number;
} | null = null;
const CATALOG_TTL = 6 * 60 * 60 * 1000;

let rateCache: { rate: number; at: number } | null = null;
const RATE_TTL = 24 * 60 * 60 * 1000;
const FALLBACK_USD_MYR = 4.5;

function admin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getSealedIndex() {
  if (catalogCache && Date.now() - catalogCache.loadedAt < CATALOG_TTL) {
    return catalogCache.index;
  }
  const db = admin();
  const products: SealedProduct[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("tcg_products")
      .select("product_id, name, image_url, tcg_groups(name)")
      .eq("is_sealed", true)
      .order("product_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      products.push({
        productId: row.product_id,
        name: row.name,
        imageUrl: row.image_url,
        groupName: (row.tcg_groups as { name: string } | null)?.name ?? null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  catalogCache = { index: buildSealedCatalogIndex(products), loadedAt: Date.now() };
  return catalogCache.index;
}

async function getUsdMyr(): Promise<number> {
  if (rateCache && Date.now() - rateCache.at < RATE_TTL) return rateCache.rate;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { rates?: { MYR?: number } };
    if (data.rates?.MYR && data.rates.MYR > 0) {
      rateCache = { rate: data.rates.MYR, at: Date.now() };
      return rateCache.rate;
    }
  } catch {
    // fall through
  }
  return FALLBACK_USD_MYR;
}

export async function POST(request: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is not set" },
      { status: 500 }
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: GEMINI_API_KEY is not set" },
      { status: 500 }
    );
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { image?: string };
  if (!body.image || typeof body.image !== "string") {
    return NextResponse.json({ error: "image (base64) is required" }, { status: 400 });
  }

  // 1. Detect items
  let detected;
  try {
    detected = await detectSealedProducts(body.image, process.env.GEMINI_API_KEY);
  } catch (err) {
    console.error("[snap-sell] detection failed:", err);
    return NextResponse.json(
      { error: "Detection failed — try again in a moment" },
      { status: 502 }
    );
  }

  if (detected.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // 2. Match each label against the sealed catalog
  const index = await getSealedIndex();
  const perItem = detected.map((d) => ({
    ...d,
    matches: matchSealedProducts(d.label, index, 3),
  }));

  // 3. Prices for every candidate in one query
  const productIds = [
    ...new Set(perItem.flatMap((i) => i.matches.map((m) => m.product.productId))),
  ];
  const priceByProduct = new Map<number, number>();
  if (productIds.length > 0) {
    const { data: prices } = await admin()
      .from("tcg_prices")
      .select("product_id, market_price")
      .in("product_id", productIds);
    for (const p of prices ?? []) {
      if (p.market_price == null) continue;
      const existing = priceByProduct.get(p.product_id);
      if (existing === undefined || p.market_price < existing) {
        priceByProduct.set(p.product_id, p.market_price);
      }
    }
  }

  const rate = await getUsdMyr();
  const items: SnapSellItem[] = perItem.map((i) => ({
    box: i.box,
    label: i.label,
    candidates: i.matches.map((m) => {
      const usd = priceByProduct.get(m.product.productId) ?? null;
      return {
        productId: m.product.productId,
        name: m.product.name,
        imageUrl: m.product.imageUrl,
        marketUsd: usd,
        priceMyr: usd != null ? Math.round(usd * rate) : null,
      };
    }),
  }));

  return NextResponse.json({ items, usdMyrRate: rate });
}
