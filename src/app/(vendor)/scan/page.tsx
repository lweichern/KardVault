"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCamera } from "@/hooks/use-camera";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useCardSearch } from "@/hooks/use-card-search";
import { useInventory } from "@/hooks/use-inventory";
import { checkPhotoQuality } from "@/lib/vision/quality";
import { AddCardModal } from "@/components/add-card-modal";
import type { IdentifyResult } from "@/lib/vision/types";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type Condition = Database["public"]["Tables"]["inventory"]["Row"]["condition"];

type ScanMode = "single" | "quick";
type SingleState = "scanning" | "identifying" | "confirmed" | "success";

// ─── Helper ────────────────────────────────────────────────────────────────

function imageDataToBase64(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.split(",")[1];
}

// ─── Quick Scan result row type ────────────────────────────────────────────

interface QuickScanResult {
  id: string; // local uuid for key
  base64: string;
  result: IdentifyResult | null;
  error: string | null;
  overrideCard: Card | null; // vendor correction
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

  const [mode, setMode] = useState<ScanMode>("quick");

  // ── Single scan state ──
  const [singleState, setSingleState] = useState<SingleState>("scanning");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [addModalCard, setAddModalCard] = useState<Card | null>(null);

  // ── Quick scan state ──
  const [photos, setPhotos] = useState<{ id: string; base64: string }[]>([]);
  const [identifying, setIdentifying] = useState(false);
  const [identifyProgress, setIdentifyProgress] = useState(0);
  const [quickResults, setQuickResults] = useState<QuickScanResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [addingBulk, setAddingBulk] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<string | null>(null); // result id

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

  // ── Mode switch ──
  function handleModeSwitch(newMode: ScanMode) {
    setMode(newMode);
    // Reset both flows
    retake();
    setSingleState("scanning");
    setSelectedCard(null);
    setAddModalCard(null);
    clearSearch();
    setPhotos([]);
    setQuickResults([]);
    setShowResults(false);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SINGLE SCAN FLOW
  // ──────────────────────────────────────────────────────────────────────────

  const handleSingleCapture = useCallback(async () => {
    const imageData = capturePhoto();
    if (!imageData) return;

    const quality = checkPhotoQuality(imageData);
    if (!quality.ok) {
      showToast(quality.reason ?? "Photo quality too low. Try again.");
      retake();
      return;
    }

    setSingleState("identifying");
    const base64 = imageDataToBase64(imageData);

    try {
      const res = await fetch("/api/scan/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: [base64] }),
      });
      const data: { results: IdentifyResult[] } = await res.json();
      const result = data.results?.[0];
      const matched = result?.match?.match ?? null;
      if (matched) {
        setSelectedCard(matched);
        setAddModalCard(matched);
        setSingleState("confirmed");
      } else {
        // No match — show search
        setSingleState("identifying");
      }
    } catch {
      showToast("Identification failed. Search manually.");
      setSingleState("identifying");
    }
  }, [capturePhoto, retake]);

  const handleSingleRetake = useCallback(() => {
    retake();
    setSingleState("scanning");
    setSelectedCard(null);
    setAddModalCard(null);
    clearSearch();
  }, [retake, clearSearch]);

  const handleSelectCard = useCallback(
    (card: Card) => {
      setSelectedCard(card);
      setAddModalCard(card);
      setSingleState("confirmed");
      clearSearch();
    },
    [clearSearch]
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
  // QUICK SCAN FLOW
  // ──────────────────────────────────────────────────────────────────────────

  const handleQuickCapture = useCallback(() => {
    const imageData = capturePhoto();
    if (!imageData) return;

    const quality = checkPhotoQuality(imageData);
    if (!quality.ok) {
      showToast(quality.reason ?? "Photo quality too low. Try again.");
      retake();
      return;
    }

    const base64 = imageDataToBase64(imageData);
    const id = crypto.randomUUID();
    setPhotos((prev) => [...prev, { id, base64 }]);
    // Retake immediately so camera stays live
    retake();
  }, [capturePhoto, retake]);

  async function handleIdentifyAll() {
    if (photos.length === 0) return;
    setIdentifying(true);
    setIdentifyProgress(0);

    const BATCH = 10;
    const allResults: QuickScanResult[] = [];

    for (let i = 0; i < photos.length; i += BATCH) {
      const batch = photos.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/scan/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: batch.map((p) => p.base64) }),
        });
        const data: { results: IdentifyResult[] } = await res.json();
        batch.forEach((photo, idx) => {
          allResults.push({
            id: photo.id,
            base64: photo.base64,
            result: data.results?.[idx] ?? null,
            error: null,
            overrideCard: null,
          });
        });
      } catch {
        batch.forEach((photo) => {
          allResults.push({
            id: photo.id,
            base64: photo.base64,
            result: null,
            error: "Identification failed",
            overrideCard: null,
          });
        });
      }
      setIdentifyProgress(Math.min(i + BATCH, photos.length));
    }

    setQuickResults(allResults);
    setShowResults(true);
    setIdentifying(false);
  }

  function handleClearPhotos() {
    setPhotos([]);
    setQuickResults([]);
    setShowResults(false);
    setBulkError(null);
    setCorrectionTarget(null);
  }

  function handleSetOverride(resultId: string, card: Card) {
    setQuickResults((prev) =>
      prev.map((r) => (r.id === resultId ? { ...r, overrideCard: card } : r))
    );
    setCorrectionTarget(null);
    clearSearch();
  }

  async function handleAddAll() {
    const toAdd = quickResults
      .map((r) => {
        const card = r.overrideCard ?? r.result?.match?.match ?? null;
        return card ? { cardId: card.id, condition: "NM" as Condition, scanSource: "quick" } : null;
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
      handleClearPhotos();
      retake();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to add cards");
    } finally {
      setAddingBulk(false);
    }
  }

  const matchedCount = quickResults.filter(
    (r) => r.overrideCard ?? r.result?.match?.match
  ).length;

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[60] bg-bg-primary flex flex-col">
      {/* Toast */}
      {toast && (
        <div className="absolute top-safe z-70 left-1/2 -translate-x-1/2 mt-4 px-4 py-2.5 rounded-full bg-bg-surface border border-border-default text-text-primary text-xs font-medium shadow-lg whitespace-nowrap pointer-events-none">
          {toast}
        </div>
      )}

      {/* Header */}
      <div
        className="relative z-10 flex items-center justify-between px-4 pb-2"
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
              mode === "single"
                ? "bg-primary-400 text-text-on-primary"
                : "text-text-muted"
            }`}
          >
            Single
          </button>
          <button
            onClick={() => handleModeSwitch("quick")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === "quick"
                ? "bg-primary-400 text-text-on-primary"
                : "text-text-muted"
            }`}
          >
            Quick Scan
          </button>
        </div>

        {/* Spacer */}
        <div className="w-9" />
      </div>

      {/* Camera viewfinder */}
      <div
        className="relative shrink-0 flex items-center justify-center bg-black"
        style={{ height: "380px" }}
      >
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
          <div className="relative z-10 text-center px-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-bg-surface mx-auto mb-3">
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

        {/* Scan frame overlay */}
        {(cameraStatus === "streaming" || cameraStatus === "captured") && (
          <div className="relative z-10 w-[220px] h-[310px]">
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary-400 rounded-tl-sm" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary-400 rounded-tr-sm" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary-400 rounded-bl-sm" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary-400 rounded-br-sm" />

            {/* Scan line — single mode scanning */}
            {mode === "single" && singleState === "scanning" && cameraStatus === "streaming" && (
              <div className="absolute left-2 right-2 h-0.5 bg-linear-to-r from-transparent via-primary-400 to-transparent animate-scan-line" />
            )}
          </div>
        )}

        {/* Hint text */}
        {cameraStatus === "streaming" &&
          ((mode === "single" && singleState === "scanning") ||
            (mode === "quick" && !showResults)) && (
            <p className="absolute bottom-19 left-0 right-0 text-center text-text-muted text-xs z-10">
              {mode === "quick"
                ? `${photos.length} photo${photos.length !== 1 ? "s" : ""} captured`
                : "Align card within the frame"}
            </p>
          )}

        {/* Capture button — single mode */}
        {mode === "single" && singleState === "scanning" && cameraStatus === "streaming" && (
          <button
            onClick={handleSingleCapture}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-15 h-15 rounded-full bg-primary-400 flex items-center justify-center border-4 border-white/30 active:scale-95 transition-transform"
          >
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
          </button>
        )}

        {/* Quick scan capture button + thumbnail strip */}
        {mode === "quick" && !showResults && cameraStatus === "streaming" && (
          <>
            {/* Thumbnails — bottom left */}
            {photos.length > 0 && (
              <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5">
                {photos.slice(-3).map((p) => (
                  <div key={p.id} className="relative w-9 h-12.5 rounded overflow-hidden border border-primary-400/60">
                    <img
                      src={`data:image/jpeg;base64,${p.base64}`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
                {photos.length > 3 && (
                  <span className="text-text-primary text-xs font-bold">+{photos.length - 3}</span>
                )}
              </div>
            )}

            {/* Shutter button */}
            <button
              onClick={handleQuickCapture}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-15 h-15 rounded-full bg-primary-400 flex items-center justify-center border-4 border-white/30 active:scale-95 transition-transform"
            >
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
            </button>

            {/* Identify All button */}
            {photos.length > 0 && (
              <button
                onClick={handleIdentifyAll}
                disabled={identifying}
                className="absolute bottom-4 right-4 z-10 h-10 px-3 rounded-xl bg-bg-surface/90 backdrop-blur-sm text-text-primary text-xs font-medium border border-border-hover disabled:opacity-60"
              >
                {identifying
                  ? `${identifyProgress}/${photos.length}`
                  : `Identify All (${photos.length})`}
              </button>
            )}
          </>
        )}

        {/* Retake button — single identifying or confirmed */}
        {mode === "single" &&
          (singleState === "identifying" || singleState === "confirmed") && (
            <button
              onClick={handleSingleRetake}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-text-primary text-sm font-medium bg-bg-surface/80 backdrop-blur-sm px-4 py-2 rounded-full"
            >
              Retake
            </button>
          )}

        {/* Success overlay */}
        {mode === "single" && singleState === "success" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
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
      </div>

      {/* Bottom panel */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}
      >
        {/* ── SINGLE SCAN BOTTOM PANEL ── */}
        {mode === "single" && (
          <>
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
                  onSelect={handleSelectCard}
                />
              </div>
            )}

            {/* Identifying — search field */}
            {singleState === "identifying" && (
              <SearchDropdown
                query={query}
                results={results}
                searching={searching}
                onSearch={search}
                onClear={clearSearch}
                onSelect={handleSelectCard}
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

        {/* ── QUICK SCAN BOTTOM PANEL ── */}
        {mode === "quick" && showResults && (
          <QuickResultsPanel
            results={quickResults}
            matchedCount={matchedCount}
            correctionTarget={correctionTarget}
            onSetCorrectionTarget={setCorrectionTarget}
            onSetOverride={handleSetOverride}
            onAddAll={handleAddAll}
            onClear={handleClearPhotos}
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
          <div className="flex flex-col items-center gap-3 pt-8">
            <div className="w-12 h-12 rounded-full border-2 border-primary-400 border-t-transparent animate-spin" />
            <p className="text-text-secondary text-sm">
              Identifying {identifyProgress} / {photos.length}...
            </p>
          </div>
        )}
      </div>

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

// ─── Quick Results Panel ────────────────────────────────────────────────────

function QuickResultsPanel({
  results,
  matchedCount,
  correctionTarget,
  onSetCorrectionTarget,
  onSetOverride,
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
  results: QuickScanResult[];
  matchedCount: number;
  correctionTarget: string | null;
  onSetCorrectionTarget: (id: string | null) => void;
  onSetOverride: (id: string, card: Card) => void;
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
        <h2 className="text-text-primary font-semibold text-[15px]">
          Scan results
        </h2>
        <span className="text-success text-sm font-medium">
          {matchedCount}/{results.length} matched
        </span>
      </div>

      {/* Results list */}
      <div className="space-y-2">
        {results.map((r) => {
          const card = r.overrideCard ?? r.result?.match?.match ?? null;
          const isMatched = !!card;
          const isCorrection = correctionTarget === r.id;

          return (
            <div key={r.id} className="bg-bg-surface rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                {/* Thumbnail */}
                <div className="w-9 h-12.5 rounded overflow-hidden bg-bg-surface-2 shrink-0">
                  <img
                    src={`data:image/jpeg;base64,${r.base64}`}
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
                      onClick={() =>
                        onSetCorrectionTarget(isCorrection ? null : r.id)
                      }
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
                      onClick={() =>
                        onSetCorrectionTarget(isCorrection ? null : r.id)
                      }
                      className="px-2 py-1 rounded-lg bg-warning/15 text-warning text-[10px] font-medium"
                    >
                      Search
                    </button>
                  )}
                </div>
              </div>

              {/* Inline correction search */}
              {isCorrection && (
                <div className="px-3 pb-3">
                  <SearchDropdown
                    query={searchQuery}
                    results={searchResults}
                    searching={searching}
                    onSearch={onSearch}
                    onClear={onClearSearch}
                    onSelect={(card) => onSetOverride(r.id, card)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {bulkError && (
        <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">
          {bulkError}
        </p>
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
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
                <p className="text-text-primary text-sm font-medium truncate">
                  {card.name}
                </p>
                <p className="text-text-secondary text-xs truncate">
                  {card.set_name} · {card.number}
                </p>
                {card.rarity && (
                  <p className="text-text-muted text-[10px]">{card.rarity}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
