// Shared request/response shapes for /api/scan/* — imported by both the
// route handlers (server) and the scan UI (client). Keep this file free of
// server-only imports.

import type { Card } from "@/lib/catalog/types";

export interface IdentifyItemPayload {
  imageFull: string;
  imageStrip?: string;
  hashFull?: string;
  hashArt?: string;
}

export interface IdentifyRequestBody {
  items: IdentifyItemPayload[];
  mode?: "photo" | "video" | "quick" | "flatlay";
  sessionId?: string;
}

export interface IdentifyResultItem {
  card: Card | null;
  candidates: Card[];
  autoAccepted: boolean;
  tierResolved: number | null;
  scanEventId: string | null;
  latencyMs: number;
}

export interface CorrectionRequestBody {
  scanEventId?: string | null;
  chosenCardId: string;
  candidatesShown?: string[];
}

/** Fire-and-forget correction logging — the error dataset for calibration. */
export function logCorrection(body: CorrectionRequestBody): void {
  void fetch("/api/scan/correction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}
