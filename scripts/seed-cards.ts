import * as dotenv from "dotenv";
import * as path from "path";
import { seedCards } from "../src/lib/seed/seed-cards";

// Load .env.local from the project root (two levels up from scripts/)
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Argument parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const setId = getArg("--set");
const localPath = getArg("--local");
const setsOnly = hasFlag("--sets-only");

// ── Banner ───────────────────────────────────────────────────────────────────
console.log("");
console.log("╔══════════════════════════════════════╗");
console.log("║       KadVault — Card Seeder         ║");
console.log("╚══════════════════════════════════════╝");
console.log("");
console.log("Source  :", localPath ? `local (${localPath})` : "GitHub (PokemonTCG/pokemon-tcg-data)");
if (setId) console.log("Set     :", setId);
if (setsOnly) console.log("Mode    : sets only (cards skipped)");
console.log("");

// ── Run ──────────────────────────────────────────────────────────────────────
const startWall = Date.now();

seedCards({
  setId,
  setsOnly,
  localPath,
  onProgress: (msg) => console.log(`  [${new Date().toISOString()}]`, msg),
})
  .then((result) => {
    const durationSec = (result.durationMs / 1000).toFixed(1);

    console.log("");
    console.log("── Summary ─────────────────────────────");
    console.log(`  Sets upserted  : ${result.setsUpserted}`);
    console.log(`  Cards upserted : ${result.cardsUpserted}`);
    console.log(`  Duration       : ${durationSec}s`);

    if (result.errors.length > 0) {
      console.log("");
      console.log(`  Errors (${result.errors.length}):`);
      for (const err of result.errors) {
        console.error("   ", err);
      }
      process.exit(1);
    } else {
      console.log("  Status         : OK");
      console.log("────────────────────────────────────────");
      console.log("");
      process.exit(0);
    }
  })
  .catch((err: unknown) => {
    console.error("");
    console.error("Fatal error:", err instanceof Error ? err.message : String(err));
    console.error("");
    process.exit(1);
  });
