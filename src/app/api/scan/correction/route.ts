import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

// Tier 4 correction logging (CLAUDE-enhance.md §2 Tier 4): every human
// correction is recorded — this is the error dataset used to tune hash
// thresholds and extraction prompts.

interface CorrectionRequest {
  scanEventId?: string;
  chosenCardId: string;
  candidatesShown?: string[];
}

export async function POST(request: NextRequest) {
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

  const body = (await request.json()) as CorrectionRequest;
  if (!body.chosenCardId || typeof body.chosenCardId !== "string") {
    return NextResponse.json({ error: "chosenCardId is required" }, { status: 400 });
  }

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Corrections must reference the caller's own scan event
  let scanEventId: string | null = null;
  if (body.scanEventId) {
    const { data: event } = await admin
      .from("scan_events")
      .select("id, vendor_id")
      .eq("id", body.scanEventId)
      .single();
    if (event && event.vendor_id === user.id) {
      scanEventId = event.id;
    }
  }

  const { error } = await admin.from("scan_corrections").insert({
    scan_event_id: scanEventId,
    candidates_shown: body.candidatesShown ?? [],
    chosen_card_id: body.chosenCardId,
  });
  if (error) {
    console.error("[scan/correction] insert failed:", error);
    return NextResponse.json({ error: "Failed to log correction" }, { status: 500 });
  }

  // Keep the event row's resolution in sync with the human's answer
  if (scanEventId) {
    await admin
      .from("scan_events")
      .update({ resolved_card_id: body.chosenCardId })
      .eq("id", scanEventId);
  }

  return NextResponse.json({ ok: true });
}
