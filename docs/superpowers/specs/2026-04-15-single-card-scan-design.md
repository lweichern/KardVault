# Single Card Scan Page — Design Spec

## Overview

Replace the placeholder scan page with a full-screen camera-based card scanning flow. Vendors capture a photo of a card, Tesseract.js OCR attempts to read the card number in the background, and a search field appears immediately. If OCR succeeds, the search is pre-filled and the card auto-selects. If OCR fails silently, the vendor types 2-3 characters to find the card via autocomplete. Once confirmed, an inline form lets them set price/condition/quantity and add to inventory.

Add-to-inventory only (no sell/remove flow in this scope).

## New Files

| File | Purpose |
|------|---------|
| `src/app/(vendor)/scan/page.tsx` | Full rewrite — camera + result panel + add flow |
| `src/lib/recognition/ocr.ts` | Tesseract.js wrapper — lazy worker init, run OCR on image blob |
| `src/lib/recognition/parser.ts` | Regex extraction of card numbers from raw OCR text |
| `src/hooks/use-camera.ts` | MediaDevices API hook — stream start/stop, photo capture via canvas |

## Dependencies to Install

- `tesseract.js` — client-side OCR engine

## Reused Existing Code

- `CardSearch` component (`src/components/card-search.tsx`) — search dropdown with autocomplete
- `useCardSearch` hook (`src/hooks/use-card-search.ts`) — debounced search against local `cards` table
- `useInventory` hook (`src/hooks/use-inventory.ts`) — `addToInventory()` method
- `useVendor` hook (`src/hooks/use-vendor.ts`) — vendor ID
- Dark theme tokens from `globals.css`

## Camera Hook (`src/hooks/use-camera.ts`)

### API

```ts
function useCamera(): {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  status: 'idle' | 'streaming' | 'captured' | 'error';
  error: string | null;
  startCamera: () => Promise<void>;
  capturePhoto: () => ImageData | null;
  retake: () => void;
  stopCamera: () => void;
}
```

### Behavior

- `startCamera()` calls `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } } })`.
- Attaches stream to a `<video>` element via ref. Sets status to `'streaming'`.
- `capturePhoto()` draws current video frame to an offscreen `<canvas>`, pauses the video (freezes frame on screen), returns the full `ImageData`. Sets status to `'captured'`.
- `retake()` resumes the video stream. Sets status back to `'streaming'`.
- `stopCamera()` stops all tracks on the stream. Called on unmount via `useEffect` cleanup.
- If `getUserMedia` fails (permission denied, no camera), sets status to `'error'` and populates `error` string.

## OCR Module (`src/lib/recognition/ocr.ts`)

### API

```ts
function initWorker(): Promise<Worker>;
function recognizeCardNumber(imageData: ImageData): Promise<string | null>;
```

### Behavior

- `initWorker()` creates a Tesseract.js worker with English language. Called lazily on first capture, not on page load. Worker instance is cached in module scope.
- `recognizeCardNumber(imageData)`:
  1. Crops to bottom 20% of the image (where card number is printed) using canvas.
  2. Applies contrast enhancement via canvas filter (`contrast(1.5) grayscale(1)`).
  3. Runs Tesseract `recognize()` on the cropped/enhanced region.
  4. Passes raw text to `parseCardNumber()` from `parser.ts`.
  5. Returns the parsed card number string, or `null` if parsing fails.

### Error handling

All errors are caught and return `null`. OCR failures are silent — the UI never shows "OCR failed." The vendor just sees an empty search field.

## Card Number Parser (`src/lib/recognition/parser.ts`)

### API

```ts
function parseCardNumber(rawText: string): string | null;
```

### Behavior

Applies regex patterns in order against the OCR text:

1. `(\d{1,3})\s*/\s*(\d{2,3})` — standard format like `025/198`
2. `([A-Z]{2,4}\d*[\-EN]*[\-]\d{2,3})` — set-prefixed like `SV1EN-025`
3. `(TG\d+)\s*/\s*(TG\d+)` — trainer gallery like `TG15/TG30`

Returns the first match (cleaned of whitespace), or `null` if no pattern matches.

## Scan Page (`src/app/(vendor)/scan/page.tsx`)

### States

The page has three visual states, flowing linearly:

1. **Scanning** — Live camera feed with overlay frame. Capture button visible.
2. **Identifying** — Photo frozen on screen. OCR running in background. Search field appears immediately below the frozen frame. If OCR finds a match, search auto-fills and card auto-selects.
3. **Confirmed** — Card details shown (image, name, set, market price). Inline form for sell price, buy price, condition, quantity. "Add to inventory" button.

A fourth transient state: **Success** — brief green checkmark flash (1 second), then auto-reset to Scanning state for the next card.

### Layout (matches CLAUDE.md Screen 3)

```
┌─────────────────────────────────┐
│ [←]          Single | Binder    │  ← Back button + mode tabs (Binder disabled)
│                                 │
│        ┌───────────────┐        │
│        │               │        │  ← Camera viewfinder (aspect 5:7)
│        │   Scan Frame  │        │     Violet corner brackets
│        │  220 × 310px  │        │     Animated scan line (scanning state only)
│        │               │        │
│        └───────────────┘        │
│     Align card within frame     │
│           [ ◉ Capture ]         │  ← Large capture button (scanning state)
├─────────────────────────────────┤
│ [Search cards... ___________]   │  ← Appears after capture (identifying state)
│                                 │
│ ┌──────┐  Charizard ex          │  ← Card result (confirmed state)
│ │ img  │  Scarlet & Violet      │
│ │      │  025/198               │
│ └──────┘  Market: RM 245.00     │
│                                 │
│ Your price (RM) [____]          │
│ Buy price (RM)  [____]          │
│ Condition: [NM][LP][MP][HP][DMG]│
│ Quantity:  [-] 1 [+]            │
│                                 │
│ [ Add to inventory ]            │  ← Primary violet button
└─────────────────────────────────┘
```

### Detailed behavior

**Scanning state:**
- Live camera feed fills the top section (dark bg around it).
- Violet corner bracket frame overlay (220×310px centered). CSS-only, using border segments on a positioned div.
- Animated scan line: a thin violet gradient line sweeping top-to-bottom inside the frame, CSS animation, 2s loop.
- Hint text below frame: "Align card within the frame" in text-muted.
- Large circular capture button (60px, primary-400 bg, white camera icon) centered below the hint.
- Back button (top-left, circle, bg-surface) navigates to `/inventory`.
- Mode tabs (top-center): "Single" active (primary-400 bg), "Binder 3x3" disabled (bg-surface, text-muted, opacity-50).

**Identifying state (after capture):**
- Video pauses, showing the frozen frame.
- Capture button disappears, replaced by "Retake" text button.
- Search field slides in below the camera area.
- OCR runs in background (no loading spinner on the search — it just appears empty and ready for typing).
- If OCR returns a card number → the `search()` function from `useCardSearch` is called with the number → results appear in dropdown → if exactly 1 result, auto-select it (transition to Confirmed).
- If OCR returns null → search field stays empty, vendor types manually.
- If OCR returns a number but no DB match → search field shows the number as text, vendor can edit or clear and search by name.

**Confirmed state:**
- Search field collapses or stays with the selected card name (not editable, but clearable to re-search).
- Card preview: image (70×98px), name (15px bold), set + card number, market price (18px bold, primary-200).
- Inline form (NOT a modal — all in the same scrollable panel):
  - Sell price input (pre-filled with market price)
  - Buy price input (optional)
  - Condition selector: 5 horizontal buttons (NM/LP/MP/HP/DMG), NM default
  - Quantity: -/+ stepper, default 1
- "Add to inventory" button (full-width, primary-400)
- Uses `useInventory().addToInventory()` on submit.

**Success state:**
- Brief green checkmark overlay (1 second), then auto-resets:
  - Camera resumes streaming
  - Form clears
  - Search clears
  - Back to Scanning state
- Vendor can immediately scan the next card.

### Permission denied / no camera fallback

If camera access is denied or unavailable:
- Show an icon + "Camera access required" message in the viewfinder area.
- Below it, show the search field so the vendor can still add cards by searching manually (the scan page doubles as a quick-add page even without a camera).

### No bottom nav

The scan page is full-screen. The bottom nav from the vendor layout is hidden. The back button is the only navigation. This is achieved by the scan page being a direct child of the vendor layout but using a full-screen fixed/absolute positioning that covers the nav.

## Out of Scope

- Binder 3x3 scan (tab shown but disabled)
- Remove/sell flow from scan page
- Condition photo upload to Supabase Storage
- Server-side OCR fallback (`POST /api/recognize`)
