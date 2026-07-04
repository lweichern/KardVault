import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getVisionProvider } from "@/lib/vision/provider";
import { getOcrProvider } from "@/lib/ocr";
import { getCatalogProvider } from "@/lib/catalog";
import type { Card } from "@/lib/catalog";
import { runWaterfall } from "@/lib/scan/waterfall";
import type { ScanInput, WaterfallDeps, WaterfallResult } from "@/lib/scan/waterfall";
import { nearestByHash } from "@/lib/scan/hash-index";
import type { IdentifyRequestBody, IdentifyResultItem } from "@/lib/scan/api-types";
import type { Database } from "@/types/database";

const MAX_ITEMS = 10;

function getAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  // Fail loudly on missing server config — a silent crash here surfaces as
  // "Not identified" on the phone, which is undebuggable in the field.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[scan/identify] SUPABASE_SERVICE_ROLE_KEY is not set");
    return NextResponse.json(
      { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is not set" },
      { status: 500 }
    );
  }

  // 1. Authenticate using Supabase SSR
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

  // 2. Parse and validate the request
  const body = (await request.json()) as IdentifyRequestBody;
  const items = body.items;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "No scan items provided" }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Max ${MAX_ITEMS} items per request` },
      { status: 400 }
    );
  }
  for (const item of items) {
    if (!item.imageFull || typeof item.imageFull !== "string") {
      return NextResponse.json(
        { error: "Each item requires an imageFull crop" },
        { status: 400 }
      );
    }
  }
  const mode = body.mode ?? "photo";

  // 3. Wire the waterfall dependencies. Tiers degrade gracefully:
  //    no hash index → Tier 1 no-op; no OCR key → Tier 2 skipped;
  //    no vision key → Tier 3 skipped (confirm UI still gets candidates).
  const admin = getAdminClient();
  let vision: WaterfallDeps["vision"] = null;
  try {
    vision = getVisionProvider();
  } catch (err) {
    console.error("[scan/identify] Vision provider unavailable:", err);
  }
  const deps: WaterfallDeps = {
    catalog: getCatalogProvider("pokemon"),
    db: admin,
    hashSearch: (hashFull, hashArt, k) => nearestByHash(hashFull, hashArt, k),
    ocr: getOcrProvider(),
    vision,
    getCardsByIds: async (ids: string[]) => {
      const { data } = await admin.from("cards").select("*").in("id", ids);
      return (data ?? []) as Card[];
    },
  };

  // 4. Run the waterfall per item concurrently
  const settled = await Promise.allSettled(
    items.map(async (item) => {
      const start = Date.now();
      const input: ScanInput = {
        imageFull: item.imageFull!,
        imageStrip: item.imageStrip,
        hashFull: item.hashFull,
        hashArt: item.hashArt,
      };
      const result = await runWaterfall(input, deps);
      return { result, latencyMs: Date.now() - start };
    })
  );

  const empty: WaterfallResult = {
    card: null,
    candidates: [],
    autoAccepted: false,
    tierResolved: null,
    telemetry: {
      hashBestDistance: null,
      hashMargin: null,
      ocrParsed: false,
      geminiCalled: false,
    },
  };
  const outcomes = settled.map((s) =>
    s.status === "fulfilled" ? s.value : { result: empty, latencyMs: 0 }
  );

  // 5. Log every attempt to scan_events (calibration + analytics dataset)
  const eventRows = outcomes.map(({ result, latencyMs }) => ({
    vendor_id: user.id,
    session_id: body.sessionId ?? null,
    mode,
    tier_resolved: result.tierResolved,
    auto_accepted: result.autoAccepted,
    hash_best_distance: result.telemetry.hashBestDistance,
    hash_margin: result.telemetry.hashMargin,
    ocr_parsed: result.telemetry.ocrParsed,
    gemini_called: result.telemetry.geminiCalled,
    resolved_card_id: result.autoAccepted ? result.card?.id ?? null : null,
    candidates: result.candidates.map((c) => c.id),
    latency_ms: latencyMs,
  }));

  let eventIds: (string | null)[] = eventRows.map(() => null);
  try {
    const { data: inserted, error: insertError } = await admin
      .from("scan_events")
      .insert(eventRows)
      .select("id");
    if (insertError) {
      // e.g. FK violation when the auth user has no vendors row
      console.error("[scan/identify] scan_events insert failed:", insertError.message);
    } else if (inserted && inserted.length === eventRows.length) {
      eventIds = inserted.map((r) => r.id);
    }
  } catch (err) {
    console.error("[scan/identify] scan_events insert failed:", err);
  }

  const results: IdentifyResultItem[] = outcomes.map(({ result, latencyMs }, i) => ({
    card: result.card,
    candidates: result.candidates,
    autoAccepted: result.autoAccepted,
    tierResolved: result.tierResolved,
    scanEventId: eventIds[i],
    latencyMs,
  }));

  return NextResponse.json({ results });
}
