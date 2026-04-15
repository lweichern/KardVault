# Single Card Scan Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-screen camera-based card scanning page where vendors capture a photo, OCR attempts to read the card number, and a search + add-to-inventory form handles the rest.

**Architecture:** Four new/rewritten files: a card number parser (pure logic), an OCR wrapper (Tesseract.js), a camera hook (MediaDevices API), and the scan page itself. The scan page reuses existing `CardSearch`, `useCardSearch`, `useInventory`, and `useVendor` from the codebase. The page uses fixed positioning to cover the vendor layout's bottom nav.

**Tech Stack:** Next.js 15, React 19, Tesseract.js, MediaDevices API, Canvas API, Tailwind CSS v4

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/recognition/parser.ts` | Create | Pure regex extraction of card numbers from OCR text |
| `src/lib/recognition/ocr.ts` | Create | Tesseract.js worker management + image preprocessing + OCR execution |
| `src/hooks/use-camera.ts` | Create | MediaDevices stream lifecycle, video→canvas capture, retake |
| `src/app/(vendor)/scan/page.tsx` | Rewrite | Full scan page UI with camera viewfinder, search, card confirm, add form |

---

### Task 1: Install tesseract.js

**Files:** `package.json`

- [ ] **Step 1: Install the dependency**

```bash
npm install tesseract.js
```

- [ ] **Step 2: Verify it installed**

```bash
node -e "require('tesseract.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add tesseract.js for client-side OCR"
```

---

### Task 2: Card number parser

**Files:**
- Create: `src/lib/recognition/parser.ts`

This is pure logic with no dependencies — the simplest piece to build first.

- [ ] **Step 1: Create the parser module**

Create `src/lib/recognition/parser.ts`:

```ts
/**
 * Extract a card number from raw OCR text.
 * Returns the cleaned card number string, or null if no recognizable pattern found.
 */
export function parseCardNumber(rawText: string): string | null {
  const text = rawText.replace(/\n/g, " ").trim();

  // Pattern 1: Standard format — 025/198, 1/100, 123/456
  const standard = text.match(/(\d{1,3})\s*\/\s*(\d{2,3})/);
  if (standard) {
    return `${standard[1]}/${standard[2]}`;
  }

  // Pattern 2: Set-prefixed — SV1-025, SV1EN-025, SWSH4-123
  const setPrefixed = text.match(/([A-Z]{2,4}\d*[A-Z]*-\d{2,3})/);
  if (setPrefixed) {
    return setPrefixed[1];
  }

  // Pattern 3: Trainer gallery — TG15/TG30
  const trainerGallery = text.match(/(TG\d+)\s*\/\s*(TG\d+)/);
  if (trainerGallery) {
    return `${trainerGallery[1]}/${trainerGallery[2]}`;
  }

  return null;
}
```

- [ ] **Step 2: Verify the module compiles**

```bash
npx tsc --noEmit src/lib/recognition/parser.ts 2>&1 || echo "Checking with full project..." && npx tsc --noEmit
```

Expected: no type errors (or only pre-existing ones unrelated to this file).

- [ ] **Step 3: Manually verify parser logic**

Run a quick Node check via tsx:

```bash
npx tsx -e "
const { parseCardNumber } = require('./src/lib/recognition/parser');
console.log(parseCardNumber('025/198') === '025/198' ? 'PASS' : 'FAIL', 'standard');
console.log(parseCardNumber('SV1EN-025') === 'SV1EN-025' ? 'PASS' : 'FAIL', 'set-prefixed');
console.log(parseCardNumber('TG15/TG30') === 'TG15/TG30' ? 'PASS' : 'FAIL', 'trainer gallery');
console.log(parseCardNumber('some random text') === null ? 'PASS' : 'FAIL', 'no match');
console.log(parseCardNumber('Card # 25 / 198 Pokemon') === '25/198' ? 'PASS' : 'FAIL', 'noisy text');
"
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/recognition/parser.ts
git commit -m "feat: add card number parser with regex extraction"
```

---

### Task 3: OCR module (Tesseract.js wrapper)

**Files:**
- Create: `src/lib/recognition/ocr.ts`

**Context:** This module wraps Tesseract.js with lazy worker init, image preprocessing (crop bottom 20%, enhance contrast), and calls the parser from Task 2. All errors return `null` silently.

- [ ] **Step 1: Create the OCR module**

Create `src/lib/recognition/ocr.ts`:

```ts
import { createWorker, Worker } from "tesseract.js";
import { parseCardNumber } from "./parser";

let worker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = await createWorker("eng");
  }
  return worker;
}

/**
 * Crop to the bottom 20% of an image and enhance contrast.
 * Returns a data URL of the processed region.
 */
function preprocessImage(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Crop bottom 20% — where card number is printed
  const cropY = Math.floor(imageData.height * 0.8);
  const cropHeight = imageData.height - cropY;

  canvas.width = imageData.width;
  canvas.height = cropHeight;

  // Draw the full image to a temp canvas first, then crop
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d")!;
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  tempCtx.putImageData(imageData, 0, 0);

  // Draw cropped region with contrast enhancement
  ctx.filter = "contrast(1.5) grayscale(1)";
  ctx.drawImage(
    tempCanvas,
    0, cropY, imageData.width, cropHeight,
    0, 0, imageData.width, cropHeight
  );

  return canvas.toDataURL("image/png");
}

/**
 * Run OCR on a captured image and try to extract a card number.
 * Returns the card number string if found, null otherwise.
 * Never throws — all errors are caught and return null.
 */
export async function recognizeCardNumber(
  imageData: ImageData
): Promise<string | null> {
  try {
    const w = await getWorker();
    const processedImage = preprocessImage(imageData);
    const { data } = await w.recognize(processedImage);
    return parseCardNumber(data.text);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify the module compiles**

```bash
npx tsc --noEmit
```

Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recognition/ocr.ts
git commit -m "feat: add Tesseract.js OCR wrapper with image preprocessing"
```

---

### Task 4: Camera hook

**Files:**
- Create: `src/hooks/use-camera.ts`

**Context:** This hook manages the MediaDevices stream lifecycle. It provides refs for a `<video>` and `<canvas>` element, functions to start/stop the camera, capture a photo (freezes frame), and retake (resumes stream). The page component will render the `<video>` and hidden `<canvas>` with these refs.

- [ ] **Step 1: Create the camera hook**

Create `src/hooks/use-camera.ts`:

```ts
"use client";

import { useRef, useState, useCallback, useEffect } from "react";

type CameraStatus = "idle" | "streaming" | "captured" | "error";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus("idle");
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("streaming");
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access in your browser settings."
          : "Could not access camera. Make sure no other app is using it.";
      setError(message);
      setStatus("error");
    }
  }, []);

  const capturePhoto = useCallback((): ImageData | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Pause video to freeze the frame on screen
    video.pause();
    setStatus("captured");

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  const retake = useCallback(() => {
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.play();
      setStatus("streaming");
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    status,
    error,
    startCamera,
    capturePhoto,
    retake,
    stopCamera,
  };
}
```

- [ ] **Step 2: Verify the module compiles**

```bash
npx tsc --noEmit
```

Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-camera.ts
git commit -m "feat: add useCamera hook for MediaDevices stream lifecycle"
```

---

### Task 5: Scan page — camera viewfinder UI (scanning state)

**Files:**
- Rewrite: `src/app/(vendor)/scan/page.tsx`

**Context:** This is the first part of the scan page rewrite. Build the full-screen camera viewfinder with the violet scan frame overlay, capture button, back button, and mode tabs. This task covers only the "scanning" state. Later tasks add the identifying/confirmed/success states.

**Existing code to know about:**
- `useCamera()` from `src/hooks/use-camera.ts` — provides `videoRef`, `canvasRef`, `startCamera`, `capturePhoto`, `status`, `error`
- `useAuth()` from `src/hooks/use-auth.ts` — provides `user`
- `useVendor()` from `src/hooks/use-vendor.ts` — provides `vendor`
- The page is rendered inside `src/app/(vendor)/layout.tsx` which always shows `<BottomNav />`. This page uses `fixed inset-0 z-50` to cover everything including the bottom nav.

- [ ] **Step 1: Rewrite the scan page with camera viewfinder**

Replace the entire contents of `src/app/(vendor)/scan/page.tsx` with:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCamera } from "@/hooks/use-camera";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useCardSearch } from "@/hooks/use-card-search";
import { useInventory } from "@/hooks/use-inventory";
import { recognizeCardNumber } from "@/lib/recognition/ocr";
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

    setSaving(true);
    setAddError(null);

    try {
      await addToInventory({
        cardId: selectedCard.id,
        sellPriceRm: sell,
        buyPriceRm: buyPrice ? parseFloat(buyPrice) : undefined,
        condition,
        quantity,
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
  }, [selectedCard, sellPrice, buyPrice, condition, quantity, addToInventory, handleRetake]);

  // Clear selected card to re-search
  const handleClearCard = useCallback(() => {
    setSelectedCard(null);
    setScanState("identifying");
    setSellPrice("");
    setBuyPrice("");
    setCondition("NM");
    setQuantity(1);
    setAddError(null);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-bg-primary flex flex-col">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-3 pb-2">
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
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8">
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

            {/* Condition selector */}
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
```

- [ ] **Step 2: Add the scan line CSS animation to globals.css**

Add this animation at the end of `src/app/globals.css`, after the `@theme inline` block:

```css
@keyframes scan-line {
  0% { top: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

.animate-scan-line {
  animation: scan-line 2s ease-in-out infinite;
}
```

- [ ] **Step 3: Verify the project builds**

```bash
npm run build
```

Expected: build succeeds with no errors. There may be warnings about unused variables — that's fine at this stage.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(vendor\)/scan/page.tsx src/app/globals.css
git commit -m "feat: build single card scan page with camera, OCR, search, and add flow"
```

---

### Task 6: Manual smoke test

**Files:** None — this is a verification task.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test in browser**

Open `http://localhost:3000/scan` in Chrome (or on a phone via local network).

Verify the following:

1. **Camera permission prompt appears** — allow it
2. **Live camera feed** fills the viewfinder area with violet corner brackets
3. **Scan line animation** sweeps vertically inside the frame
4. **Back button** navigates to `/inventory`
5. **Capture button** freezes the frame and shows the search field below
6. **Search field** accepts typing, autocomplete dropdown appears after 2+ chars
7. **Selecting a card** shows the card preview + price/condition/quantity form
8. **"Add to inventory" button** saves and shows green checkmark, then resets to camera
9. **Retake button** resets to live camera feed
10. **Bottom nav is hidden** — the scan page covers the entire screen
11. **Camera error fallback** — if you deny camera permission, search field appears as fallback

- [ ] **Step 3: Commit any fixes if needed**

If any issues were found during testing, fix them and commit:

```bash
git add -A
git commit -m "fix: address scan page issues from smoke test"
```
