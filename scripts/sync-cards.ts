#!/usr/bin/env tsx
/**
 * Standalone card sync script.
 *
 * Usage:
 *   npx tsx scripts/sync-cards.ts              # full sync (all ~20K cards)
 *   npx tsx scripts/sync-cards.ts --since 7    # incremental: last 7 days
 *   npm run sync:cards                         # via npm script
 *   npm run sync:cards:incremental             # last 7 days via npm script
 *
 * Env vars loaded from .env.local automatically.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// We can't use @/ path alias outside of Next.js, so use relative imports
import { syncCards } from "../src/lib/sync/sync-cards";

async function main() {
  const args = process.argv.slice(2);
  let since: Date | undefined;

  const sinceIndex = args.indexOf("--since");
  if (sinceIndex !== -1 && args[sinceIndex + 1]) {
    const days = parseInt(args[sinceIndex + 1], 10);
    if (isNaN(days) || days < 1) {
      console.error("--since requires a positive number of days");
      process.exit(1);
    }
    since = new Date();
    since.setDate(since.getDate() - days);
  }

  const apiKey = process.env.POKEMONTCG_API_KEY;

  console.log("═══════════════════════════════════════");
  console.log("  KardVault Card Sync");
  console.log("═══════════════════════════════════════");
  console.log(`Mode:     ${since ? "incremental" : "full"}`);
  console.log(`API Key:  ${apiKey ? "configured" : "not set (lower rate limit)"}`);
  if (since) {
    console.log(`Since:    ${since.toISOString().split("T")[0]}`);
  }
  console.log("───────────────────────────────────────");

  try {
    const result = await syncCards({
      apiKey,
      since,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    console.log("───────────────────────────────────────");
    console.log(`  Fetched:   ${result.totalFetched} cards`);
    console.log(`  Upserted:  ${result.totalUpserted} cards`);
    console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(1)}s`);

    if (result.errors.length > 0) {
      console.log(`  Errors:    ${result.errors.length}`);
      result.errors.forEach((e) => console.log(`    - ${e}`));
    }

    console.log("═══════════════════════════════════════");
    process.exit(result.errors.length > 0 ? 1 : 0);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
