import * as dotenv from "dotenv";
import * as path from "path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import * as fs from "fs";
import { phash } from "../src/lib/scan/phash";
import { cropFraction, type RawImage } from "../src/lib/scan/raw-image";
import { detectCardQuad, blurScore, glareScore } from "../src/lib/scan/detect";
import { warpPerspective, CARD_W, CARD_H, type Point } from "../src/lib/scan/geometry";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// End-to-end test of the DEPLOYED scan waterfall without a phone:
//  1. create a throwaway user (admin API) and sign in
//  2. serialize the session into the exact cookie format @supabase/ssr expects
//  3. send a real catalog card image through /api/scan/identify
//  4. assert the waterfall identifies it and logs a scan_event
//
// Usage:
//   npx tsx scripts/test-scan-e2e.ts [--base-url URL] [--card base1-4]
//   npx tsx scripts/test-scan-e2e.ts --image ./charizard.png [--expect base1-4]
// With --image, the REAL photo runs the same client pipeline as the phone
// (full-frame detection -> warp -> gates -> strip crop -> pHashes).

const args = process.argv.slice(2);
function getArg(flag: string, fallback: string): string {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE_URL = getArg("--base-url", "https://kard-vault.vercel.app").replace(/\/$/, "");
const CARD_ID = getArg("--card", "base1-4"); // Base Set Charizard
const IMAGE_PATH = getArg("--image", "");
const EXPECT_ID = getArg("--expect", CARD_ID);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 1. Throwaway user ──────────────────────────────────────────────────────
  const email = `e2e-scan-test-${Date.now()}@example.com`;
  const password = `E2e!${Math.random().toString(36).slice(2)}${Date.now()}`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser: ${createErr?.message}`);
  const userId = created.user.id;
  await admin.from("vendors").insert({
    id: userId,
    display_name: "E2E Scan Test",
    whatsapp_number: "+60000000000",
    slug: `e2e-test-${Date.now()}`,
  });
  console.log(`1. created test user + vendor row (${email})`);

  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signIn.session) throw new Error(`signIn: ${signInErr?.message}`);
    console.log("2. signed in, got session");

    // ── 2. Session → @supabase/ssr cookie format ─────────────────────────────
    const jar = new Map<string, string>();
    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => {
          for (const c of cookies) jar.set(c.name, c.value);
        },
      },
    });
    await ssr.auth.setSession({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
    const cookieHeader = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
    if (!cookieHeader) throw new Error("ssr client produced no cookies");
    console.log(`3. built session cookies (${jar.size} cookie(s))`);

    // ── 3. Build scan payload ─────────────────────────────────────────────────
    let buf: Buffer;
    let label: string;
    if (IMAGE_PATH) {
      buf = fs.readFileSync(IMAGE_PATH);
      label = IMAGE_PATH;
    } else {
      const { data: cardRow } = await admin
        .from("cards")
        .select("id, name, image_small")
        .eq("id", CARD_ID)
        .single();
      if (!cardRow?.image_small) throw new Error(`card ${CARD_ID} has no image`);
      const imgRes = await fetch(cardRow.image_small);
      buf = Buffer.from(await imgRes.arrayBuffer());
      label = `catalog:${CARD_ID}`;
    }

    const { data: rawData, info } = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let raw: RawImage = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(rawData.buffer, rawData.byteOffset, rawData.byteLength),
    };

    if (IMAGE_PATH) {
      // Replicate the phone's client pipeline: full-frame detection -> warp
      const quad = detectCardQuad(raw);
      const corners: [Point, Point, Point, Point] = quad?.corners ?? [
        { x: 0, y: 0 },
        { x: raw.width - 1, y: 0 },
        { x: raw.width - 1, y: raw.height - 1 },
        { x: 0, y: raw.height - 1 },
      ];
      console.log(
        `   detection: ${quad ? `quad found (score ${quad.score.toFixed(2)})` : "none — using full image"}`
      );
      raw = warpPerspective(raw, corners, CARD_W, CARD_H);
      console.log(
        `   gates: blur=${blurScore(raw).toFixed(0)} glare(strip)=${glareScore(
          cropFraction(raw, 0, 0.88, 1, 0.12)
        ).toFixed(3)}`
      );
    }

    const art = cropFraction(raw, 0.09, 0.11, 0.82, 0.36);
    const strip = cropFraction(raw, 0, 0.88, 1, 0.12);
    const hashFull = phash(raw);
    const hashArt = phash(art);

    const toJpeg = (img: RawImage, scale = 1) =>
      sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
        raw: { width: img.width, height: img.height, channels: 4 },
      })
        .resize(Math.round(img.width * scale))
        .jpeg({ quality: 85 })
        .toBuffer();
    const fullJpeg = await toJpeg(raw);
    const stripJpeg = await toJpeg(strip, 2);
    console.log(`4. payload ready for ${label}, hashFull=${hashFull}`);

    // ── 4. Fire at the deployed waterfall ────────────────────────────────────
    const res = await fetch(`${BASE_URL}/api/scan/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({
        items: [
          {
            imageFull: fullJpeg.toString("base64"),
            imageStrip: stripJpeg.toString("base64"),
            hashFull,
            hashArt,
          },
        ],
        mode: "photo",
      }),
    });
    console.log(`5. POST /api/scan/identify → HTTP ${res.status}`);
    const body = await res.json();
    if (!res.ok) {
      console.error("   response:", JSON.stringify(body));
      throw new Error(`identify returned ${res.status}`);
    }
    const r = body.results?.[0];
    console.log(
      `   card: ${r?.card?.id} (${r?.card?.name}) | autoAccepted: ${r?.autoAccepted} | tier: ${r?.tierResolved}`
    );
    console.log(
      `   candidates: ${(r?.candidates ?? []).map((c: { id: string }) => c.id).join(", ")}`
    );
    console.log(`   scanEventId: ${r?.scanEventId}`);

    // ── 5. Verify telemetry landed ────────────────────────────────────────────
    if (r?.scanEventId) {
      const { data: event } = await admin
        .from("scan_events")
        .select("tier_resolved, auto_accepted, hash_best_distance, hash_margin, gemini_called, latency_ms")
        .eq("id", r.scanEventId)
        .single();
      console.log("6. scan_event row:", JSON.stringify(event));
      await admin.from("scan_events").delete().eq("id", r.scanEventId);
    } else {
      console.warn("6. no scanEventId — telemetry insert failed server-side");
    }

    const pass = r?.card?.id === EXPECT_ID;
    console.log("");
    console.log(pass ? `PASS — deployed waterfall identified ${EXPECT_ID}` : `FAIL — expected ${EXPECT_ID}`);
    if (!pass) process.exitCode = 1;
  } finally {
    await admin.from("vendors").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
    console.log("7. cleaned up test user + vendor");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
