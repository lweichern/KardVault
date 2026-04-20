import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getVisionProvider } from "@/lib/vision/provider";
import { matchCard } from "@/lib/vision/match";
import type { IdentifyResult, ScanResult } from "@/lib/vision/types";

const MAX_IMAGES = 10;

const CONFIDENCE_SCORE: Record<string, number> = {
  exact: 1.0,
  high: 0.8,
  medium: 0.6,
  low: 0.3,
  none: 0.0,
};

export async function POST(request: NextRequest) {
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

  // 2. Parse request body
  const body = await request.json();
  const { images, mode } = body as { images: string[]; mode: string };

  if (!images || !Array.isArray(images) || images.length === 0) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Max ${MAX_IMAGES} images per request` },
      { status: 400 }
    );
  }

  // 3. Get provider and process images concurrently
  const provider = getVisionProvider();

  const settled = await Promise.allSettled(
    images.map(async (imageBase64): Promise<IdentifyResult> => {
      const start = Date.now();
      let scan: ScanResult;
      try {
        scan = await provider.identify(imageBase64);
      } catch {
        scan = {
          card_name: null,
          set_name: null,
          card_number: null,
          hp: null,
          rarity: null,
          card_type: null,
          subtypes: null,
          regulation_mark: null,
          confidence: "low",
          is_graded: false,
          grading_company: null,
          grade: null,
          subgrades: null,
          cert_number: null,
        };
      }
      const match = await matchCard(scan);
      return { scan, match, latency_ms: Date.now() - start };
    })
  );

  const results: IdentifyResult[] = settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : {
          scan: {
            card_name: null,
            set_name: null,
            card_number: null,
            hp: null,
            rarity: null,
            card_type: null,
            subtypes: null,
            regulation_mark: null,
            confidence: "low" as const,
            is_graded: false,
            grading_company: null,
            grade: null,
            subgrades: null,
            cert_number: null,
          },
          match: { match: null, confidence: "none" as const },
          latency_ms: 0,
        }
  );

  // 4. Log scans (fire-and-forget)
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const logs = results.map((r) => ({
    vendor_id: user.id,
    scan_mode: mode || "single_scan",
    vision_model: provider.name,
    api_response: r.scan as unknown as Record<string, unknown>,
    matched_card_id: r.match.match?.id ?? null,
    confidence: CONFIDENCE_SCORE[r.match.confidence] ?? null,
    latency_ms: r.latency_ms,
  }));
  adminClient.from("scan_logs").insert(logs).then(() => {});

  return NextResponse.json({ results });
}
