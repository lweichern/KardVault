import { NextResponse } from "next/server";
import { syncCards } from "@/lib/sync/sync-cards";

/**
 * GET /api/prices/sync
 *
 * Triggers a card data + price sync from pokemontcg.io.
 * Protected by a shared secret (CRON_SECRET) to prevent public abuse.
 *
 * Query params:
 *   ?since=7   — incremental sync (last N days). Omit for full sync.
 *
 * Can be called by:
 *   - Vercel Cron Jobs (set in vercel.json)
 *   - Manual curl with the secret header
 */
export async function GET(request: Request) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sinceDays = searchParams.get("since");

  let since: Date | undefined;
  if (sinceDays) {
    const days = parseInt(sinceDays, 10);
    if (!isNaN(days) && days > 0) {
      since = new Date();
      since.setDate(since.getDate() - days);
    }
  }

  try {
    const logs: string[] = [];
    const result = await syncCards({
      apiKey: process.env.POKEMONTCG_API_KEY,
      since,
      onProgress: (msg) => logs.push(msg),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// This route can take a while for full syncs
export const maxDuration = 300; // 5 minutes (Vercel Pro limit)
