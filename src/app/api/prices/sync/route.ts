import { NextResponse } from "next/server";
import { seedCards } from "@/lib/seed/seed-cards";

/**
 * GET /api/prices/sync
 *
 * Triggers a card data sync from the pokemon-tcg-data GitHub source.
 * Protected by a shared secret (CRON_SECRET) to prevent public abuse.
 *
 * Query params:
 *   ?set=sv1   — sync only a specific set by ID. Omit for full sync.
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
  const setId = searchParams.get("set") ?? undefined;

  try {
    const logs: string[] = [];
    const result = await seedCards({
      setId,
      onProgress: (msg: string) => logs.push(msg),
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
