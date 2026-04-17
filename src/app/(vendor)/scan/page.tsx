"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCamera } from "@/hooks/use-camera";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useCardSearch } from "@/hooks/use-card-search";
import { useInventory } from "@/hooks/use-inventory";
import { recognizeCardNumber } from "@/lib/recognition/ocr";
import { GradingSelector, type GradingCompany } from "@/components/grading-selector";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type Condition = Database["public"]["Tables"]["inventory"]["Row"]["condition"];

const CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];

type ScanState = "scanning" | "identifying" | "confirmed" | "success";

export default function ScanPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);
  const { videoRef, canvasRef, status: cameraStatus, error: cameraError, startCamera, capturePhoto, retake } = useCamera();
  const { query, results, searching, search, clear: clearSearch } = useCardSearch();
  const { addToInventory } = useInventory(vendor?.id);

  const [scanState, setScanState] = useState<ScanState>("scanning");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [quantity, setQuantity] = useState(1);
  const [isGraded, setIsGraded] = useState(false);
  const [gradingCompany, setGradingCompany] = useState<GradingCompany | null>(null);
  const [grade, setGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Start camera on mount
  useEffect(() => {
    startCamera();
  }, [startCamera]);

  // Handle photo capture
  const handleCapture = useCallback(async () => {
    const imageData = capturePhoto();
    if (!imageData) return;

    setScanState("identifying");

    // Run OCR in background — don't await before showing search
    recognizeCardNumber(imageData).then((cardNumber) => {
      if (cardNumber) {
        search(cardNumber);
      }
    });
  }, [capturePhoto, search]);

  // Handle retake
  const handleRetake = useCallback(() => {
    retake();
    setScanState("scanning");
    setSelectedCard(null);
    clearSearch();
    setSellPrice("");
    setBuyPrice("");
    setCondition("NM");
    setQuantity(1);
    setIsGraded(false);
    setGradingCompany(null);
    setGrade("");
    setAddError(null);
  }, [retake, clearSearch]);

  // Handle card selection from search
  const handleSelectCard = useCallback((card: Card) => {
    setSelectedCard(card);
    setScanState("confirmed");
    setSellPrice((card.market_price_rm ?? 0).toFixed(2));
    clearSearch();
  }, [clearSearch]);

  // Auto-select if OCR returns exactly 1 result
  useEffect(() => {
    if (scanState === "identifying" && results.length === 1 && !searching) {
      handleSelectCard(results[0]);
    }
  }, [scanState, results, searching, handleSelectCard]);

  // Handle add to inventory
  const handleAdd = useCallback(async () => {
    if (!selectedCard) return;
    const sell = parseFloat(sellPrice);
    if (isNaN(sell) || sell <= 0) {
      setAddError("Enter a valid sell price");
      return;
    }
    if (isGraded && (!gradingCompany || !grade)) {
      setAddError("Select a grading company and grade");
      return;
    }

    setSaving(true);
    setAddError(null);

    try {
      await addToInventory({
        cardId: selectedCard.id,
        sellPriceRm: sell,
        buyPriceRm: buyPrice ? parseFloat(buyPrice) : undefined,
        condition,
        quantity,
        gradingCompany: isGraded ? gradingCompany ?? undefined : undefined,
        grade: isGraded ? grade || undefined : undefined,
      });

      setScanState("success");

      // Auto-reset after 1 second
      setTimeout(() => {
        handleRetake();
        setScanState("scanning");
      }, 1000);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add card");
      setSaving(false);
    }
  }, [selectedCard, sellPrice, buyPrice, condition, quantity, isGraded, gradingCompany, grade, addToInventory, handleRetake]);

  // Clear selected card to re-search
  const handleClearCard = useCallback(() => {
    setSelectedCard(null);
    setScanState("identifying");
    setSellPrice("");
    setBuyPrice("");
    setCondition("NM");
    setQuantity(1);
    setIsGraded(false);
    setGradingCompany(null);
    setGrade("");
    setAddError(null);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-bg-primary flex flex-col">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 pb-2" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}>
        <button
          onClick={() => router.push("/inventory")}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-bg-surface/80 backdrop-blur-sm"
        >
          <svg className="w-5 h-5 text-text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        {/* Mode tabs */}
        <div className="flex bg-bg-surface/80 backdrop-blur-sm rounded-lg p-0.5">
          <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary-400 text-text-on-primary">
            Single
          </button>
          <button className="px-3 py-1.5 text-xs font-medium rounded-md text-text-muted opacity-50 cursor-not-allowed">
            Binder 3×3
          </button>
        </div>

        {/* Spacer to balance the back button */}
        <div className="w-9" />
      </div>

      {/* Camera viewfinder */}
      <div className="relative flex-shrink-0 flex items-center justify-center bg-black" style={{ height: "380px" }}>
        {/* Video element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Camera error state */}
        {cameraStatus === "error" && (
          <div className="relative z-10 text-center px-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-bg-surface mx-auto mb-3">
              <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 0 0-2.25-2.25h-9c-.621 0-1.184.252-1.591.659m12.182 12.182L2.909 5.909M1.5 4.5l1.409 1.409" />
              </svg>
            </div>
            <p className="text-text-secondary text-sm">{cameraError}</p>
          </div>
        )}

        {/* Scan frame overlay — only when streaming or captured */}
        {(cameraStatus === "streaming" || cameraStatus === "captured") && (
          <div className="relative z-10 w-[220px] h-[310px]">
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary-400 rounded-tl-sm" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary-400 rounded-tr-sm" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary-400 rounded-bl-sm" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary-400 rounded-br-sm" />

            {/* Animated scan line — only during scanning */}
            {scanState === "scanning" && cameraStatus === "streaming" && (
              <div
                className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-primary-400 to-transparent animate-scan-line"
              />
            )}
          </div>
        )}

        {/* Hint text */}
        {scanState === "scanning" && cameraStatus === "streaming" && (
          <p className="absolute bottom-16 left-0 right-0 text-center text-text-muted text-xs z-10">
            Align card within the frame
          </p>
        )}

        {/* Capture button */}
        {scanState === "scanning" && cameraStatus === "streaming" && (
          <button
            onClick={handleCapture}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[60px] h-[60px] rounded-full bg-primary-400 flex items-center justify-center border-4 border-white/30 active:scale-95 transition-transform"
          >
            <svg className="w-6 h-6 text-text-on-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
            </svg>
          </button>
        )}

        {/* Retake button — after capture */}
        {(scanState === "identifying" || scanState === "confirmed") && (
          <button
            onClick={handleRetake}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-text-primary text-sm font-medium bg-bg-surface/80 backdrop-blur-sm px-4 py-2 rounded-full"
          >
            Retake
          </button>
        )}

        {/* Success overlay */}
        {scanState === "success" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
            <div className="flex items-center justify-center w-20 h-20 rounded-full bg-success/20">
              <svg className="w-10 h-10 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 pt-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}>
        {/* Camera error fallback — show search even without camera */}
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

        {/* Identifying state — search field */}
        {scanState === "identifying" && (
          <SearchDropdown
            query={query}
            results={results}
            searching={searching}
            onSearch={search}
            onClear={clearSearch}
            onSelect={handleSelectCard}
          />
        )}

        {/* Confirmed state — card details + add form */}
        {scanState === "confirmed" && selectedCard && (
          <div className="space-y-4">
            {/* Selected card preview — tappable to re-search */}
            <div className="flex items-center gap-3">
              {selectedCard.image_small ? (
                <img
                  src={selectedCard.image_small}
                  alt={selectedCard.name}
                  className="w-[70px] h-[98px] rounded-lg object-cover bg-bg-surface-2 flex-shrink-0"
                />
              ) : (
                <div className="w-[70px] h-[98px] rounded-lg bg-bg-surface-2 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-text-primary font-semibold text-[15px] truncate">
                  {selectedCard.name}
                </h3>
                <p className="text-text-secondary text-xs">
                  {selectedCard.set_name} · {selectedCard.card_number}
                </p>
                {selectedCard.market_price_rm != null && (
                  <p className="text-primary-200 text-sm font-medium mt-1">
                    Market: RM {selectedCard.market_price_rm.toFixed(2)}
                  </p>
                )}
              </div>
              <button
                onClick={handleClearCard}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-bg-surface-2 text-text-muted hover:text-text-secondary"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Price inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-text-secondary text-xs font-medium mb-1">
                  Your price (RM)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  className="w-full h-11 bg-bg-surface-2 text-text-primary rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-text-secondary text-xs font-medium mb-1">
                  Buy price (RM)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  placeholder="Optional"
                  className="w-full h-11 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
                />
              </div>
            </div>

            {/* Grading */}
            <GradingSelector
              isGraded={isGraded}
              onToggleGraded={setIsGraded}
              company={gradingCompany}
              onCompanyChange={setGradingCompany}
              grade={grade}
              onGradeChange={setGrade}
            />

            {/* Condition selector — only for raw cards */}
            {!isGraded && (
              <div>
                <label className="block text-text-secondary text-xs font-medium mb-1.5">
                  Condition
                </label>
                <div className="flex gap-2">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCondition(c)}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                        condition === c
                          ? "bg-primary-400 text-text-on-primary border-primary-400"
                          : "bg-bg-surface-2 text-text-secondary border-border-default hover:border-border-hover"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="block text-text-secondary text-xs font-medium mb-1">
                Quantity
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover"
                >
                  −
                </button>
                <span className="text-text-primary text-lg font-medium w-8 text-center">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover"
                >
                  +
                </button>
              </div>
            </div>

            {addError && (
              <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">
                {addError}
              </p>
            )}

            {/* Add button */}
            <button
              onClick={handleAdd}
              disabled={saving}
              className="w-full h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl disabled:opacity-50 transition-opacity"
            >
              {saving ? "Adding..." : "Add to inventory"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Inline search dropdown component ─── */

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
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
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
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
                  className="w-[42px] h-[58px] rounded object-cover bg-bg-surface-2 flex-shrink-0"
                />
              ) : (
                <div className="w-[42px] h-[58px] rounded bg-bg-surface-2 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium truncate">{card.name}</p>
                <p className="text-text-secondary text-xs truncate">
                  {card.set_name} · {card.card_number}
                </p>
                {card.rarity && (
                  <p className="text-text-muted text-[10px]">{card.rarity}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                {card.market_price_rm != null && (
                  <p className="text-text-primary text-sm font-medium">
                    RM {card.market_price_rm.toFixed(2)}
                  </p>
                )}
                {card.tcgplayer_market_price != null && (
                  <p className="text-text-muted text-[10px]">
                    ${card.tcgplayer_market_price.toFixed(2)} USD
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
