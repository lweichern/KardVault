"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCamera } from "@/hooks/use-camera";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useCardSearch } from "@/hooks/use-card-search";
import { useInventory } from "@/hooks/use-inventory";
import { useVideoScan } from "@/hooks/use-video-scan";
import {
  processCapture,
  guideRectFromLayout,
  type CaptureArtifacts,
} from "@/lib/scan/capture";
import { hammingHex } from "@/lib/scan/phash";
import { majorityVote } from "@/lib/scan/vote";
import { playScanBeep } from "@/lib/scan/beep";
import {
  logCorrection,
  type IdentifyItemPayload,
  type IdentifyResultItem,
} from "@/lib/scan/api-types";
import { AddCardModal } from "@/components/add-card-modal";
import { CandidatePicker } from "@/components/candidate-picker";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type Condition = Database["public"]["Tables"]["inventory"]["Row"]["condition"];

type ScanMode = "single" | "quick" | "video";
type SingleState = "scanning" | "identifying" | "choosing" | "confirmed" | "success";

// Framing-guide size (CSS px). Drives both the overlay and the capture-crop
// mapping — keep them in sync via these constants. 0.71 ≈ card aspect (63:88).
const GUIDE_W = 250;
const GUIDE_H = 352;

// ─── Helpers ───────────────────────────────────────────────────────────────

function artifactsToPayload(a: CaptureArtifacts): IdentifyItemPayload {
  return {
    imageFull: a.fullBase64,
    imageStrip: a.stripBase64,
    hashFull: a.hashFull,
    hashArt: a.hashArt,
  };
}

async function identify(
  items: IdentifyItemPayload[],
  mode: "photo" | "quick" | "video",
  sessionId?: string
): Promise<IdentifyResultItem[]> {
  const res = await fetch("/api/scan/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, mode, sessionId }),
  });
  if (!res.ok) throw new Error(`identify failed: ${res.status}`);
  const data: { results: IdentifyResultItem[] } = await res.json();
  return data.results ?? [];
}

/** The card a batch row resolves to — only human-confirmed or auto-accepted. */
function resolvedCard(r: BatchScanResult): Card | null {
  if (r.overrideCard) return r.overrideCard;
  if (r.result?.autoAccepted && r.result.card) return r.result.card;
  return null;
}

// ─── Batch (quick/video) result row ────────────────────────────────────────

interface BatchScanResult {
  id: string; // local uuid for key
  thumbBase64: string; // warped crop thumbnail
  result: IdentifyResultItem | null;
  error: string | null;
  overrideCard: Card | null; // vendor confirmation/correction
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function ScanPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);
  const {
    videoRef,
    canvasRef,
    status: cameraStatus,
    error: cameraError,
    startCamera,
    capturePhoto,
    retake,
  } = useCamera();
  const { query, results, searching, search, clear: clearSearch } = useCardSearch();
  const { addToInventory, addBulkToInventory } = useInventory(vendor?.id);

  const isPro = vendor?.tier === "pro";
  const [mode, setMode] = useState<ScanMode>("quick");
  const cameraContainerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // ── Single scan state ──
  const [singleState, setSingleState] = useState<SingleState>("scanning");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [addModalCard, setAddModalCard] = useState<Card | null>(null);
  const [singleCandidates, setSingleCandidates] = useState<Card[]>([]);
  const [singleScanEventId, setSingleScanEventId] = useState<string | null>(null);

  // ── Batch state (quick photos + video session) ──
  const [photos, setPhotos] = useState<{ id: string; artifacts: CaptureArtifacts }[]>([]);
  const [identifying, setIdentifying] = useState(false);
  const [identifyProgress, setIdentifyProgress] = useState(0);
  const [batchResults, setBatchResults] = useState<BatchScanResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [addingBulk, setAddingBulk] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<string | null>(null);

  // Video-mode dedup: pHashes accepted in the last few seconds
  const recentHashes = useRef<{ hash: string; at: number }[]>([]);
  const videoBusy = useRef(false);

  // ── Toast ──
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // Start camera on mount
  useEffect(() => {
    startCamera();
  }, [startCamera]);

  const getGuideRect = useCallback(() => {
    const container = cameraContainerRef.current;
    const video = videoRef.current;
    if (!container || !video) return null;
    return guideRectFromLayout(container, video, GUIDE_W, GUIDE_H);
  }, [videoRef]);

  // Consecutive quality-gate failures. Thresholds are device-dependent, so
  // after 2 rejections the next tap captures anyway — the confirm UI is the
  // real safety net; gates must never hard-lock the shutter.
  const gateFails = useRef(0);

  /** Capture the current frame and run the client pipeline. */
  const captureArtifacts = useCallback((): CaptureArtifacts | null => {
    const frame = capturePhoto();
    if (!frame) return null;
    const guide = getGuideRect() ?? {
      // Fallback: centred card-aspect region
      x: frame.width * 0.2,
      y: frame.height * 0.1,
      w: frame.width * 0.6,
      h: frame.height * 0.8,
    };
    const outcome = processCapture(frame, guide, {
      skipQualityGates: gateFails.current >= 2,
    });
    if (!outcome.ok) {
      gateFails.current++;
      showToast(
        gateFails.current >= 2
          ? `${outcome.reason} Tap again to capture anyway.`
          : outcome.reason
      );
      retake();
      return null;
    }
    gateFails.current = 0;
    return outcome.artifacts;
  }, [capturePhoto, getGuideRect, retake]);

  // ── Mode switch ──
  function handleModeSwitch(newMode: ScanMode) {
    if (newMode === "video" && !isPro) {
      showToast("Video auto-scan is a Kad Pro feature");
      return;
    }
    setMode(newMode);
    retake();
    setSingleState("scanning");
    setSelectedCard(null);
    setAddModalCard(null);
    setSingleCandidates([]);
    setSingleScanEventId(null);
    clearSearch();
    setPhotos([]);
    setBatchResults([]);
    setShowResults(false);
    setBulkError(null);
    setCorrectionTarget(null);
    recentHashes.current = [];
    gateFails.current = 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SINGLE SCAN FLOW
  // ──────────────────────────────────────────────────────────────────────────

  const handleSingleCapture = useCallback(async () => {
    const artifacts = captureArtifacts();
    if (!artifacts) return;

    setSingleState("identifying");
    try {
      const [result] = await identify(
        [artifactsToPayload(artifacts)],
        "photo",
        sessionIdRef.current
      );
      setSingleScanEventId(result?.scanEventId ?? null);

      if (result?.autoAccepted && result.card) {
        setSelectedCard(result.card);
        setAddModalCard(result.card);
        setSingleState("confirmed");
      } else if (result && result.candidates.length > 0) {
        // Tier 4: human confirm — one tap, never a silent low-confidence insert
        setSingleCandidates(result.candidates);
        setSingleState("choosing");
      } else {
        showToast("Couldn't identify — search for the card");
        setSingleState("identifying");
      }
    } catch {
      showToast("Identification failed. Search manually.");
      setSingleState("identifying");
    }
  }, [captureArtifacts]);

  const handleSingleRetake = useCallback(() => {
    retake();
    setSingleState("scanning");
    setSelectedCard(null);
    setAddModalCard(null);
    setSingleCandidates([]);
    setSingleScanEventId(null);
    clearSearch();
  }, [retake, clearSearch]);

  const confirmSingleCard = useCallback(
    (card: Card, viaCandidates: boolean) => {
      // Every human choice is logged — this is the calibration error dataset
      logCorrection({
        scanEventId: singleScanEventId,
        chosenCardId: card.id,
        candidatesShown: viaCandidates ? singleCandidates.map((c) => c.id) : [],
      });
      setSelectedCard(card);
      setAddModalCard(card);
      setSingleState("confirmed");
      setSingleCandidates([]);
      clearSearch();
    },
    [singleScanEventId, singleCandidates, clearSearch]
  );

  async function handleSingleAdd(params: {
    cardId: string;
    priceMyr?: number;
    condition: Condition;
    quantity: number;
    gradingCompany?: string;
    grade?: string;
    subgrades?: Record<string, string>;
    certNumber?: string;
  }) {
    await addToInventory({ ...params, scanSource: "single" });
    setSingleState("success");
    setAddModalCard(null);
    setTimeout(() => {
      handleSingleRetake();
    }, 900);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUICK SCAN FLOW (multi-photo batch)
  // ──────────────────────────────────────────────────────────────────────────

  const handleQuickCapture = useCallback(() => {
    const artifacts = captureArtifacts();
    if (!artifacts) return;
    setPhotos((prev) => [...prev, { id: crypto.randomUUID(), artifacts }]);
    // Retake immediately so the camera stays live
    retake();
  }, [captureArtifacts, retake]);

  async function handleIdentifyAll() {
    if (photos.length === 0) return;
    setIdentifying(true);
    setIdentifyProgress(0);

    const BATCH = 10;
    const allResults: BatchScanResult[] = [];

    for (let i = 0; i < photos.length; i += BATCH) {
      const batch = photos.slice(i, i + BATCH);
      try {
        const results = await identify(
          batch.map((p) => artifactsToPayload(p.artifacts)),
          "quick",
          sessionIdRef.current
        );
        batch.forEach((photo, idx) => {
          allResults.push({
            id: photo.id,
            thumbBase64: photo.artifacts.fullBase64,
            result: results[idx] ?? null,
            error: null,
            overrideCard: null,
          });
        });
      } catch {
        batch.forEach((photo) => {
          allResults.push({
            id: photo.id,
            thumbBase64: photo.artifacts.fullBase64,
            result: null,
            error: "Identification failed",
            overrideCard: null,
          });
        });
      }
      setIdentifyProgress(Math.min(i + BATCH, photos.length));
    }

    setBatchResults(allResults);
    setShowResults(true);
    setIdentifying(false);
  }

  function handleClearBatch() {
    setPhotos([]);
    setBatchResults([]);
    setShowResults(false);
    setBulkError(null);
    setCorrectionTarget(null);
    recentHashes.current = [];
  }

  const handleConfirmBatchCard = useCallback(
    (resultId: string, card: Card, viaCandidates: boolean) => {
      setBatchResults((prev) =>
        prev.map((r) => {
          if (r.id !== resultId) return r;
          logCorrection({
            scanEventId: r.result?.scanEventId ?? null,
            chosenCardId: card.id,
            candidatesShown: viaCandidates
              ? (r.result?.candidates ?? []).map((c) => c.id)
              : [],
          });
          return { ...r, overrideCard: card };
        })
      );
      setCorrectionTarget(null);
      clearSearch();
    },
    [clearSearch]
  );

  async function handleAddAll() {
    const toAdd = batchResults
      .map((r) => {
        const card = resolvedCard(r);
        return card
          ? { cardId: card.id, condition: "NM" as Condition, scanSource: mode as string }
          : null;
      })
      .filter((x): x is { cardId: string; condition: Condition; scanSource: string } => x !== null);

    if (toAdd.length === 0) {
      showToast("No matched cards to add");
      return;
    }

    setAddingBulk(true);
    setBulkError(null);
    try {
      await addBulkToInventory(toAdd);
      showToast(`Added ${toAdd.length} card${toAdd.length !== 1 ? "s" : ""} to inventory`);
      handleClearBatch();
      retake();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to add cards");
    } finally {
      setAddingBulk(false);
    }
  }

  const matchedCount = batchResults.filter((r) => resolvedCard(r)).length;

  // ──────────────────────────────────────────────────────────────────────────
  // VIDEO AUTO-SCAN FLOW (Pro) — burst capture + majority vote + dedup
  // ──────────────────────────────────────────────────────────────────────────

  const handleBurst = useCallback(
    async (burst: CaptureArtifacts[]) => {
      if (videoBusy.current) return;

      // Dedup: suppress near-identical crops seen in the last 5 seconds
      const now = Date.now();
      recentHashes.current = recentHashes.current.filter((h) => now - h.at < 5000);
      const newHash = burst[0].hashFull;
      if (recentHashes.current.some((h) => hammingHex(h.hash, newHash) <= 8)) {
        return;
      }

      videoBusy.current = true;
      try {
        const results = await identify(
          burst.map(artifactsToPayload),
          "video",
          sessionIdRef.current
        );
        recentHashes.current.push({ hash: newHash, at: Date.now() });

        const voted = majorityVote(results.filter((r) => r.autoAccepted));
        const entryId = crypto.randomUUID();

        if (voted?.card) {
          playScanBeep();
          setBatchResults((prev) => [
            {
              id: entryId,
              thumbBase64: burst[0].fullBase64,
              result: voted,
              error: null,
              overrideCard: null,
            },
            ...prev,
          ]);
        } else {
          // No agreement — queue for the confirm UI with the best candidates
          const best =
            results.find((r) => r.candidates.length > 0) ?? results[0] ?? null;
          setBatchResults((prev) => [
            {
              id: entryId,
              thumbBase64: burst[0].fullBase64,
              result: best,
              error: best ? null : "Identification failed",
              overrideCard: null,
            },
            ...prev,
          ]);
        }
      } catch {
        // Video mode is continuous — swallow errors, the vendor just rescans
      } finally {
        videoBusy.current = false;
      }
    },
    []
  );

  useVideoScan(
    videoRef,
    getGuideRect,
    mode === "video" && isPro && cameraStatus === "streaming",
    { onBurst: handleBurst }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────

  const showBatchPanel = (mode === "quick" && showResults) || mode === "video";

  // Bottom sheet slides over the full-screen camera when there is content
  const sheetVisible =
    (mode === "single" &&
      (cameraStatus === "error" ||
        singleState === "identifying" ||
        singleState === "choosing" ||
        (singleState === "confirmed" && !!selectedCard && !addModalCard))) ||
    (mode === "quick" && (identifying || showResults)) ||
    (mode === "video" && (!isPro || batchResults.length > 0));

  return (
    <div ref={cameraContainerRef} className="fixed inset-0 z-[60] bg-black">
      {/* Full-screen camera */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Camera error */}
      {cameraStatus === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-bg-surface mb-3">
            <svg
              className="w-8 h-8 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 0 0-2.25-2.25h-9c-.621 0-1.184.252-1.591.659m12.182 12.182L2.909 5.909M1.5 4.5l1.409 1.409"
              />
            </svg>
          </div>
          <p className="text-text-secondary text-sm">{cameraError}</p>
        </div>
      )}

      {/* Guide frame — centred over the camera */}
      {(cameraStatus === "streaming" || cameraStatus === "captured") && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="relative" style={{ width: GUIDE_W, height: GUIDE_H }}>
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary-400 rounded-tl-sm" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary-400 rounded-tr-sm" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary-400 rounded-bl-sm" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary-400 rounded-br-sm" />

            {/* Scan line — single scanning or video live */}
            {cameraStatus === "streaming" &&
              ((mode === "single" && singleState === "scanning") || mode === "video") && (
                <div className="absolute left-2 right-2 h-0.5 bg-linear-to-r from-transparent via-primary-400 to-transparent animate-scan-line" />
              )}
          </div>
        </div>
      )}

      {/* Toast — offset below the notch/Dynamic Island via safe-area inset */}
      {toast && (
        <div
          className="absolute z-70 left-1/2 -translate-x-1/2 max-w-[85vw] px-4 py-2.5 rounded-2xl bg-bg-surface border border-border-default text-text-primary text-xs font-medium shadow-lg text-center pointer-events-none"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
        >
          {toast}
        </div>
      )}

      {/* Header — floating over the camera */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pb-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <button
          onClick={() => router.push("/inventory")}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-bg-surface/80 backdrop-blur-sm"
        >
          <svg
            className="w-5 h-5 text-text-primary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        {/* Mode tabs */}
        <div className="flex bg-bg-surface/80 backdrop-blur-sm rounded-lg p-0.5">
          <button
            onClick={() => handleModeSwitch("single")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === "single" ? "bg-primary-400 text-text-on-primary" : "text-text-muted"
            }`}
          >
            Single
          </button>
          <button
            onClick={() => handleModeSwitch("quick")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === "quick" ? "bg-primary-400 text-text-on-primary" : "text-text-muted"
            }`}
          >
            Quick
          </button>
          <button
            onClick={() => handleModeSwitch("video")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === "video" ? "bg-primary-400 text-text-on-primary" : "text-text-muted"
            }`}
          >
            Video
            {!isPro && (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Spacer */}
        <div className="w-9" />
      </div>

      {/* Bottom controls — floating above the home indicator */}
      {cameraStatus === "streaming" && !sheetVisible && (
        <div
          className="absolute left-0 right-0 z-20"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
        >
          {/* Hint text */}
          {((mode === "single" && singleState === "scanning") ||
            (mode === "quick" && !showResults) ||
            mode === "video") && (
            <p className="text-center text-text-primary/80 text-xs mb-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              {mode === "quick"
                ? `${photos.length} photo${photos.length !== 1 ? "s" : ""} captured`
                : mode === "video"
                  ? "Hold each card steady in the frame — it beeps when captured"
                  : "Align card within the frame"}
            </p>
          )}

          <div className="relative flex items-center justify-center">
            {/* Single shutter */}
            {mode === "single" && singleState === "scanning" && (
              <button
                onClick={handleSingleCapture}
                className="w-16 h-16 rounded-full bg-primary-400 flex items-center justify-center border-4 border-white/30 active:scale-95 transition-transform"
              >
                <CameraIcon />
              </button>
            )}

            {/* Quick: thumbnails + shutter + identify all */}
            {mode === "quick" && !showResults && (
              <>
                {photos.length > 0 && (
                  <div className="absolute left-4 flex items-center gap-1.5">
                    {photos.slice(-3).map((p) => (
                      <div
                        key={p.id}
                        className="relative w-9 h-12.5 rounded overflow-hidden border border-primary-400/60"
                      >
                        <img
                          src={`data:image/jpeg;base64,${p.artifacts.fullBase64}`}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                    {photos.length > 3 && (
                      <span className="text-text-primary text-xs font-bold">
                        +{photos.length - 3}
                      </span>
                    )}
                  </div>
                )}

                <button
                  onClick={handleQuickCapture}
                  className="w-16 h-16 rounded-full bg-primary-400 flex items-center justify-center border-4 border-white/30 active:scale-95 transition-transform"
                >
                  <CameraIcon />
                </button>

                {photos.length > 0 && (
                  <button
                    onClick={handleIdentifyAll}
                    disabled={identifying}
                    className="absolute right-4 h-10 px-3 rounded-xl bg-bg-surface/90 backdrop-blur-sm text-text-primary text-xs font-medium border border-border-hover disabled:opacity-60"
                  >
                    {identifying
                      ? `${identifyProgress}/${photos.length}`
                      : `Identify All (${photos.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Success overlay */}
      {mode === "single" && singleState === "success" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="flex items-center justify-center w-20 h-20 rounded-full bg-success/20">
            <svg
              className="w-10 h-10 text-success"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        </div>
      )}

      {/* Bottom sheet — slides over the camera when there is content */}
      {sheetVisible && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-30 bg-bg-primary rounded-t-2xl border-t border-border-default overflow-y-auto px-4 ${
            mode === "video" ? "max-h-[35vh]" : "max-h-[65vh]"
          }`}
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
        >
          {/* Grabber */}
          <div className="sticky top-0 bg-bg-primary pt-2.5 pb-3 z-10">
            <div className="w-9 h-1 rounded-full bg-border-hover mx-auto" />
          </div>

          {/* ── SINGLE SCAN SHEET ── */}
          {mode === "single" && (
            <>
              {/* Retake row for post-capture states */}
              {cameraStatus !== "error" &&
                (singleState === "identifying" ||
                  singleState === "choosing" ||
                  singleState === "confirmed") && (
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-text-primary text-sm font-semibold">
                      {singleState === "choosing" ? "Which card is this?" : "Scan result"}
                    </p>
                    <button
                      onClick={handleSingleRetake}
                      className="text-primary-200 text-xs font-medium px-3 py-1.5 rounded-full border border-border-default"
                    >
                      Retake
                    </button>
                  </div>
                )}

              {/* Camera error fallback search */}
              {cameraStatus === "error" && !selectedCard && (
                <div className="mb-4">
                  <p className="text-text-secondary text-xs mb-2">Search for a card to add:</p>
                  <SearchDropdown
                    query={query}
                    results={results}
                    searching={searching}
                    onSearch={search}
                    onClear={clearSearch}
                    onSelect={(card) => confirmSingleCard(card, false)}
                  />
                </div>
              )}

              {/* Choosing — Tier 4 confirm UI */}
              {singleState === "choosing" && singleCandidates.length > 0 && (
                <CandidatePicker
                  compact
                  candidates={singleCandidates}
                  onSelect={(card) => confirmSingleCard(card, true)}
                  onSearchInstead={() => {
                    setSingleCandidates([]);
                    setSingleState("identifying");
                  }}
                />
              )}

              {/* Identifying — search field */}
              {singleState === "identifying" && (
                <SearchDropdown
                  query={query}
                  results={results}
                  searching={searching}
                  onSearch={search}
                  onClear={clearSearch}
                  onSelect={(card) => confirmSingleCard(card, false)}
                />
              )}

              {/* Confirmed — card preview */}
              {singleState === "confirmed" && selectedCard && !addModalCard && (
                <div className="flex items-center gap-3 bg-bg-surface rounded-xl p-3">
                  {selectedCard.image_small ? (
                    <img
                      src={selectedCard.image_small}
                      alt={selectedCard.name}
                      className="w-14 h-19.5 rounded-lg object-cover bg-bg-surface-2 shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-19.5 rounded-lg bg-bg-surface-2 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-semibold text-[15px] truncate">
                      {selectedCard.name}
                    </p>
                    <p className="text-text-secondary text-xs">
                      {selectedCard.set_name} · {selectedCard.number}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── VIDEO MODE — Pro gate ── */}
          {mode === "video" && !isPro && (
            <div className="flex flex-col items-center gap-3 py-4 text-center px-6">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary-800">
                <svg
                  className="w-7 h-7 text-primary-200"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <p className="text-text-primary text-sm font-semibold">
                Video auto-scan is a Kad Pro feature
              </p>
              <p className="text-text-secondary text-xs">
                Slide cards through the frame and hear a beep as each one is identified — no
                tapping, no waiting.
              </p>
            </div>
          )}

          {/* ── BATCH RESULTS (quick results / video session list) ── */}
          {showBatchPanel && (mode !== "video" || isPro) && batchResults.length > 0 && (
            <BatchResultsPanel
              results={batchResults}
              matchedCount={matchedCount}
              correctionTarget={correctionTarget}
              onSetCorrectionTarget={setCorrectionTarget}
              onConfirmCard={handleConfirmBatchCard}
              onAddAll={handleAddAll}
              onClear={handleClearBatch}
              addingBulk={addingBulk}
              bulkError={bulkError}
              searchQuery={query}
              searchResults={results}
              searching={searching}
              onSearch={search}
              onClearSearch={clearSearch}
            />
          )}

          {/* Quick scan — identifying progress */}
          {mode === "quick" && identifying && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full border-2 border-primary-400 border-t-transparent animate-spin" />
              <p className="text-text-secondary text-sm">
                Identifying {identifyProgress} / {photos.length}...
              </p>
            </div>
          )}
        </div>
      )}

      {/* AddCardModal — single scan */}
      {addModalCard && (
        <AddCardModal
          card={addModalCard}
          onAdd={handleSingleAdd}
          onClose={() => {
            setAddModalCard(null);
            handleSingleRetake();
          }}
        />
      )}
    </div>
  );
}

// ─── Camera shutter icon ────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg
      className="w-6 h-6 text-text-on-primary"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z"
      />
    </svg>
  );
}

// ─── Batch Results Panel (quick + video session) ────────────────────────────

function BatchResultsPanel({
  results,
  matchedCount,
  correctionTarget,
  onSetCorrectionTarget,
  onConfirmCard,
  onAddAll,
  onClear,
  addingBulk,
  bulkError,
  searchQuery,
  searchResults,
  searching,
  onSearch,
  onClearSearch,
}: {
  results: BatchScanResult[];
  matchedCount: number;
  correctionTarget: string | null;
  onSetCorrectionTarget: (id: string | null) => void;
  onConfirmCard: (id: string, card: Card, viaCandidates: boolean) => void;
  onAddAll: () => void;
  onClear: () => void;
  addingBulk: boolean;
  bulkError: string | null;
  searchQuery: string;
  searchResults: Card[];
  searching: boolean;
  onSearch: (q: string) => void;
  onClearSearch: () => void;
}) {
  return (
    <div className="space-y-3">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <h2 className="text-text-primary font-semibold text-[15px]">Scan results</h2>
        <span className="text-success text-sm font-medium">
          {matchedCount}/{results.length} matched
        </span>
      </div>

      {/* Results list */}
      <div className="space-y-2">
        {results.map((r) => {
          const card = resolvedCard(r);
          const isMatched = !!card;
          const candidates = r.result?.candidates ?? [];
          const needsConfirm = !isMatched && candidates.length > 0;
          const isExpanded = correctionTarget === r.id;

          return (
            <div key={r.id} className="bg-bg-surface rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                {/* Thumbnail */}
                <div className="w-9 h-12.5 rounded overflow-hidden bg-bg-surface-2 shrink-0">
                  <img
                    src={`data:image/jpeg;base64,${r.thumbBase64}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Match info */}
                <div className="flex-1 min-w-0">
                  {isMatched ? (
                    <>
                      <p className="text-text-primary text-sm font-medium truncate">
                        {card.name}
                      </p>
                      <p className="text-text-secondary text-xs truncate">
                        {card.set_name} · {card.number}
                      </p>
                    </>
                  ) : needsConfirm ? (
                    <>
                      <p className="text-text-primary text-sm font-medium truncate">
                        {candidates[0].name}?
                      </p>
                      <p className="text-warning text-xs">Tap to confirm</p>
                    </>
                  ) : (
                    <>
                      <p className="text-text-muted text-sm">Not identified</p>
                      <p className="text-text-muted text-xs">Tap to search</p>
                    </>
                  )}
                </div>

                {/* Status / action */}
                <div className="shrink-0">
                  {isMatched ? (
                    <button
                      onClick={() => onSetCorrectionTarget(isExpanded ? null : r.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-success/15"
                    >
                      <svg
                        className="w-4 h-4 text-success"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m4.5 12.75 6 6 9-13.5"
                        />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={() => onSetCorrectionTarget(isExpanded ? null : r.id)}
                      className="px-2 py-1 rounded-lg bg-warning/15 text-warning text-[10px] font-medium"
                    >
                      {needsConfirm ? "Confirm" : "Search"}
                    </button>
                  )}
                </div>
              </div>

              {/* Inline confirm / correction */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  {candidates.length > 0 && (
                    <CandidatePicker
                      compact
                      candidates={candidates}
                      onSelect={(c) => onConfirmCard(r.id, c, true)}
                      onSearchInstead={() => {
                        /* search field below is always visible */
                      }}
                    />
                  )}
                  <SearchDropdown
                    query={searchQuery}
                    results={searchResults}
                    searching={searching}
                    onSearch={onSearch}
                    onClear={onClearSearch}
                    onSelect={(c) => onConfirmCard(r.id, c, false)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {bulkError && (
        <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">{bulkError}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onClear}
          className="flex-1 h-12 text-text-secondary text-sm font-medium rounded-xl border border-border-default hover:bg-bg-hover transition-colors"
        >
          Clear
        </button>
        <button
          onClick={onAddAll}
          disabled={addingBulk || matchedCount === 0}
          className="flex-2 h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl disabled:opacity-50 transition-opacity"
        >
          {addingBulk
            ? "Adding..."
            : `Add ${matchedCount} card${matchedCount !== 1 ? "s" : ""} to inventory`}
        </button>
      </div>
    </div>
  );
}

// ─── Inline search dropdown ─────────────────────────────────────────────────

function SearchDropdown({
  query,
  results,
  searching,
  onSearch,
  onClear,
  onSelect,
}: {
  query: string;
  results: Card[];
  searching: boolean;
  onSearch: (q: string) => void;
  onClear: () => void;
  onSelect: (card: Card) => void;
}) {
  return (
    <div className="relative">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search cards..."
          autoFocus
          className="w-full bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl pl-10 pr-10 py-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
        />
        {query && (
          <button
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {(results.length > 0 || (searching && query.length >= 2)) && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-bg-surface border border-border-default rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {searching && results.length === 0 && (
            <div className="px-4 py-3 text-text-muted text-sm">Searching...</div>
          )}
          {!searching && results.length === 0 && query.length >= 2 && (
            <div className="px-4 py-3 text-text-muted text-sm">No cards found</div>
          )}
          {results.map((card) => (
            <button
              key={card.id}
              onClick={() => onSelect(card)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover transition-colors text-left"
            >
              {card.image_small ? (
                <img
                  src={card.image_small}
                  alt={card.name}
                  className="w-10.5 h-14.5 rounded object-cover bg-bg-surface-2 shrink-0"
                />
              ) : (
                <div className="w-10.5 h-14.5 rounded bg-bg-surface-2 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium truncate">{card.name}</p>
                <p className="text-text-secondary text-xs truncate">
                  {card.set_name} · {card.number}
                </p>
                {card.rarity && <p className="text-text-muted text-[10px]">{card.rarity}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
