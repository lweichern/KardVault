"use client";

// Video auto-scan loop (CLAUDE-enhance.md §4). Video frames are used for
// FRAME SELECTION ONLY — nothing leaves the device until a stable, sharp,
// glare-free card triggers a burst capture. The burst's warped crops go
// through the same waterfall as photo mode.

import { useEffect, useRef, useCallback, type RefObject } from "react";
import { detectCardQuad } from "@/lib/scan/detect";
import { processCapture, type CaptureArtifacts, type GuideRect } from "@/lib/scan/capture";
import type { Point } from "@/lib/scan/geometry";

const FRAME_INTERVAL_MS = 100; // ~10fps — throttled for thermal/battery
const STABLE_FRAMES = 4; // ≥400ms of a stationary card
const DRIFT_TOLERANCE = 0.03; // corner drift as fraction of frame width
const MIN_GUIDE_FILL = 0.4; // detected quad must cover ≥40% of guide area
const BURST_SIZE = 3;
const BURST_GAP_MS = 90;
const COOLDOWN_MS = 1500; // after a burst, wait before re-arming

export interface VideoScanCallbacks {
  /** Burst of quality-gated capture artifacts (1..3). Majority-vote upstream. */
  onBurst: (artifacts: CaptureArtifacts[]) => void;
}

export function useVideoScan(
  videoRef: RefObject<HTMLVideoElement | null>,
  getGuideRect: () => GuideRect | null,
  enabled: boolean,
  { onBurst }: VideoScanCallbacks
) {
  const stableCount = useRef(0);
  const lastCorners = useRef<Point[] | null>(null);
  const busy = useRef(false);
  const cooldownUntil = useRef(0);
  const onBurstRef = useRef(onBurst);
  onBurstRef.current = onBurst;

  const grabFrame = useCallback((): ImageData | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [videoRef]);

  useEffect(() => {
    if (!enabled) {
      stableCount.current = 0;
      lastCorners.current = null;
      return;
    }

    const timer = setInterval(async () => {
      if (busy.current || Date.now() < cooldownUntil.current) return;
      const video = videoRef.current;
      const guide = getGuideRect();
      if (!video || video.paused || !guide) return;

      busy.current = true;
      try {
        const frame = grabFrame();
        if (!frame) return;

        // Local detection only — is there a stationary card in the guide?
        const quad = detectCardQuad(frame);
        if (!quad) {
          stableCount.current = 0;
          lastCorners.current = null;
          return;
        }

        // Size gate: quad must fill enough of the guide
        const quadArea = polygonArea(quad.corners);
        if (quadArea < guide.w * guide.h * MIN_GUIDE_FILL) {
          stableCount.current = 0;
          lastCorners.current = null;
          return;
        }

        // Stability gate: corners stationary across consecutive frames
        const tolerance = frame.width * DRIFT_TOLERANCE;
        if (lastCorners.current && maxDrift(quad.corners, lastCorners.current) <= tolerance) {
          stableCount.current++;
        } else {
          stableCount.current = 1;
        }
        lastCorners.current = quad.corners;
        if (stableCount.current < STABLE_FRAMES) return;

        // Burst capture: 3 frames, each quality-gated + warped.
        // Voting upstream kills transient glare/blur failures.
        const artifacts: CaptureArtifacts[] = [];
        for (let i = 0; i < BURST_SIZE; i++) {
          const burstFrame = i === 0 ? frame : grabFrame();
          if (burstFrame) {
            const outcome = processCapture(burstFrame, guide);
            if (outcome.ok) artifacts.push(outcome.artifacts);
          }
          if (i < BURST_SIZE - 1) {
            await new Promise((r) => setTimeout(r, BURST_GAP_MS));
          }
        }

        stableCount.current = 0;
        lastCorners.current = null;
        cooldownUntil.current = Date.now() + COOLDOWN_MS;

        if (artifacts.length > 0) {
          onBurstRef.current(artifacts);
        }
      } finally {
        busy.current = false;
      }
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [enabled, videoRef, getGuideRect, grabFrame]);
}

function polygonArea(c: Point[]): number {
  let area = 0;
  for (let i = 0; i < c.length; i++) {
    const j = (i + 1) % c.length;
    area += c[i].x * c[j].y - c[j].x * c[i].y;
  }
  return Math.abs(area) / 2;
}

function maxDrift(a: Point[], b: Point[]): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  }
  return max;
}
