"use client";

// Client capture pipeline (CLAUDE-enhance.md §3): guide-region crop → card
// boundary detection + perspective warp → quality gates → identifier-strip
// zoom crop → perceptual hashes → JPEG payloads for the waterfall API.
// All downstream tiers consume the warped crop, never the raw photo.

import type { RawImage } from "./raw-image";
import { cropRaw, cropFraction } from "./raw-image";
import { CARD_W, CARD_H, warpPerspective, type Point } from "./geometry";
import { detectCardQuad, blurScore, glareScore, BLUR_MIN, GLARE_MAX } from "./detect";
import { phash } from "./phash";
import { getCatalogProvider } from "@/lib/catalog";

export interface GuideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureArtifacts {
  /** Warped full-card crop (512×716), base64 JPEG. */
  fullBase64: string;
  /** Identifier-strip crop upscaled 2×, base64 JPEG. */
  stripBase64: string;
  hashFull: string;
  hashArt: string;
  /** True when boundary detection succeeded (vs. guide-rect fallback). */
  detected: boolean;
}

export type CaptureOutcome =
  | { ok: true; artifacts: CaptureArtifacts }
  | { ok: false; reason: string };

const GUIDE_MARGIN = 0.08;
const STRIP_SCALE = 2;
const JPEG_QUALITY = 0.85;

function rawToJpegBase64(raw: RawImage, scale = 1): string {
  const canvas = document.createElement("canvas");
  canvas.width = raw.width;
  canvas.height = raw.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height),
    0,
    0
  );

  let source: HTMLCanvasElement = canvas;
  if (scale !== 1) {
    const scaled = document.createElement("canvas");
    scaled.width = Math.round(raw.width * scale);
    scaled.height = Math.round(raw.height * scale);
    const sctx = scaled.getContext("2d")!;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    source = scaled;
  }
  return source.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
}

/**
 * Map the on-screen framing guide (CSS pixels, centred in the camera
 * container) to video-frame pixel coordinates, accounting for object-cover
 * scaling. Returns null until the video has dimensions.
 */
export function guideRectFromLayout(
  container: HTMLElement,
  video: HTMLVideoElement,
  guideW = 220,
  guideH = 310
): GuideRect | null {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!cw || !ch || !vw || !vh) return null;

  const scale = Math.max(cw / vw, ch / vh); // object-cover
  const offX = (cw - vw * scale) / 2;
  const offY = (ch - vh * scale) / 2;
  const gx = (cw - guideW) / 2;
  const gy = (ch - guideH) / 2;

  return {
    x: (gx - offX) / scale,
    y: (gy - offY) / scale,
    w: guideW / scale,
    h: guideH / scale,
  };
}

export interface CaptureOptions {
  /**
   * Bypass blur/glare gates. Used as an escape hatch after repeated gate
   * failures — thresholds are device-dependent and the Tier 4 confirm UI is
   * the real safety net, so gates must never hard-lock capture.
   */
  skipQualityGates?: boolean;
}

/**
 * Process a captured camera frame into waterfall inputs.
 * `guideRect` is the framing-guide rectangle in frame pixel coordinates —
 * when boundary detection fails, the guide IS the card (the vendor aligned it).
 */
export function processCapture(
  frame: ImageData,
  guideRect: GuideRect,
  options: CaptureOptions = {}
): CaptureOutcome {
  // 1. Detect the card on the FULL frame first — vendors often fill the
  //    screen with the card rather than fitting it inside the guide, and a
  //    guide-only crop would then capture half a card.
  let source: RawImage = frame;
  let corners: [Point, Point, Point, Point] | null = null;
  let blurRegion: RawImage = frame;
  let detected = false;

  const fullQuad = detectCardQuad(frame);
  if (fullQuad) {
    detected = true;
    corners = fullQuad.corners;
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    blurRegion = cropRaw(frame, minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY);
  } else {
    // 2. Fall back to the guide region plus margin; if detection fails there
    //    too, the guide IS the card (the vendor aligned it).
    const mx = guideRect.w * GUIDE_MARGIN;
    const my = guideRect.h * GUIDE_MARGIN;
    const regionX = Math.max(0, guideRect.x - mx);
    const regionY = Math.max(0, guideRect.y - my);
    const region = cropRaw(
      frame,
      regionX,
      regionY,
      guideRect.w + 2 * mx,
      guideRect.h + 2 * my
    );
    const regionQuad = detectCardQuad(region);
    detected = !!regionQuad;
    source = region;
    blurRegion = region;
    corners = regionQuad?.corners ?? [
      { x: guideRect.x - regionX, y: guideRect.y - regionY },
      { x: guideRect.x - regionX + guideRect.w, y: guideRect.y - regionY },
      { x: guideRect.x - regionX + guideRect.w, y: guideRect.y - regionY + guideRect.h },
      { x: guideRect.x - regionX, y: guideRect.y - regionY + guideRect.h },
    ];
  }

  // 3. Blur gate on the NATIVE-resolution card area. The perspective warp's
  //    bilinear resampling smooths pixels and crushes Laplacian variance, so
  //    gating on the warped crop rejects perfectly sharp captures.
  if (!options.skipQualityGates && blurScore(blurRegion) < BLUR_MIN) {
    return { ok: false, reason: "Hold steady — the photo looks blurry." };
  }

  // 4. Warp to the canonical flat card.
  const warped = warpPerspective(source, corners, CARD_W, CARD_H);

  // 5. Identifier strip: crop per game layout, glare-gate, zoom for OCR.
  const regions = getCatalogProvider("pokemon").identifierRegions();
  const stripSpec = regions.find((r) => r.key === "identifier")!;
  const artSpec = regions.find((r) => r.key === "art")!;
  const strip = cropFraction(warped, stripSpec.x, stripSpec.y, stripSpec.w, stripSpec.h);
  if (!options.skipQualityGates && glareScore(strip) > GLARE_MAX) {
    return { ok: false, reason: "Tilt the card slightly to reduce glare." };
  }

  // 6. Perceptual hashes for Tier 1.
  const art = cropFraction(warped, artSpec.x, artSpec.y, artSpec.w, artSpec.h);
  const hashFull = phash(warped);
  const hashArt = phash(art);

  return {
    ok: true,
    artifacts: {
      fullBase64: rawToJpegBase64(warped),
      stripBase64: rawToJpegBase64(strip, STRIP_SCALE),
      hashFull,
      hashArt,
      detected,
    },
  };
}
