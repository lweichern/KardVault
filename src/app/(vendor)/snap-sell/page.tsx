"use client";

// Snap & Sell (CLAUDE-enhance.md §5): photograph a flat-lay of sealed
// products → detect + identify each → pre-fill prices from tcg_prices →
// vendor confirms/edits on a mandatory review screen → render price badges
// onto the photo → share sheet. Kills the manual Canva workflow.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import type { SnapSellItem, SnapSellCandidate } from "@/app/api/snap-sell/identify/route";

type Stage = "pick" | "identifying" | "review";

interface ReviewItem {
  id: string;
  box: { x: number; y: number; w: number; h: number };
  label: string;
  candidates: SnapSellCandidate[];
  chosenIdx: number; // -1 = none chosen (manual price only)
  priceMyr: string; // editable
  removed: boolean;
}

const API_IMAGE_MAX = 1280;
const RENDER_MAX = 2048;

async function fileToScaledDataUrl(file: File, maxSide: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not read the photo"));
      img.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function SnapSellPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);
  const isPro = vendor?.tier === "pro";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("pick");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null); // render-res
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setStage("identifying");
    try {
      const [renderUrl, apiUrl] = await Promise.all([
        fileToScaledDataUrl(file, RENDER_MAX),
        fileToScaledDataUrl(file, API_IMAGE_MAX),
      ]);
      setPhotoUrl(renderUrl);

      const res = await fetch("/api/snap-sell/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: apiUrl.split(",")[1] }),
      });
      if (!res.ok) {
        let message = `Identification failed (HTTP ${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // keep default
        }
        throw new Error(message);
      }
      const data: { items: SnapSellItem[] } = await res.json();

      setItems(
        data.items.map((item) => ({
          id: crypto.randomUUID(),
          box: item.box,
          label: item.label,
          candidates: item.candidates,
          chosenIdx: item.candidates.length > 0 ? 0 : -1,
          priceMyr: item.candidates[0]?.priceMyr != null ? String(item.candidates[0].priceMyr) : "",
          removed: false,
        }))
      );
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStage("pick");
    }
  }

  function updateItem(id: string, patch: Partial<ReviewItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  const activeItems = items.filter((i) => !i.removed);
  const pricedCount = activeItems.filter((i) => i.priceMyr.trim() !== "").length;

  async function handleGenerate() {
    if (!photoUrl) return;
    setSharing(true);
    setError(null);
    try {
      const blob = await renderPricedImage(photoUrl, activeItems, {
        watermark: !isPro,
        handle: vendor?.slug ? `kardvault.com/v/${vendor.slug}` : null,
      });
      const file = new File([blob], `kardvault-sale-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      // AbortError = user closed the share sheet; not an error
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Could not generate the image");
      }
    } finally {
      setSharing(false);
    }
  }

  const editingItem = items.find((i) => i.id === editing) ?? null;

  return (
    <div className="px-4 pt-6 pb-8">
      {/* Header */}
      <header className="flex items-center gap-3 mb-5">
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-bg-surface"
        >
          <svg className="w-5 h-5 text-text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h1 className="text-text-primary text-lg font-bold">Snap &amp; Sell</h1>
          <p className="text-text-secondary text-xs">
            Price a whole photo of sealed products in one go
          </p>
        </div>
      </header>

      {error && (
        <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      {/* ── PICK ── */}
      {stage === "pick" && (
        <div className="space-y-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-2xl border-2 border-dashed border-border-hover bg-bg-surface p-10 flex flex-col items-center gap-3"
          >
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary-800">
              <svg className="w-7 h-7 text-primary-200" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-text-primary text-sm font-semibold">Snap or choose a photo</p>
              <p className="text-text-secondary text-xs mt-1">
                Lay products flat, no overlap, good light
              </p>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <p className="text-text-muted text-[11px] text-center">
            Each product gets a price badge from today&apos;s TCGplayer market data — review
            and adjust before sharing.
          </p>
        </div>
      )}

      {/* ── IDENTIFYING ── */}
      {stage === "identifying" && (
        <div className="flex flex-col items-center gap-4 pt-10">
          {photoUrl && (
            <img src={photoUrl} alt="" className="w-full rounded-2xl opacity-60" />
          )}
          <div className="flex items-center gap-3 -mt-2">
            <div className="w-5 h-5 rounded-full border-2 border-primary-400 border-t-transparent animate-spin" />
            <p className="text-text-secondary text-sm">Identifying products…</p>
          </div>
        </div>
      )}

      {/* ── REVIEW ── */}
      {stage === "review" && photoUrl && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden">
            <img src={photoUrl} alt="" className="w-full" />
            {activeItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setEditing(item.id)}
                className="absolute -translate-x-1/2 -translate-y-full px-2.5 py-1 rounded-full bg-bg-primary/90 border border-primary-400/60 text-text-primary text-xs font-bold shadow-lg whitespace-nowrap"
                style={{
                  left: `${(item.box.x + item.box.w / 2) * 100}%`,
                  top: `${(item.box.y + item.box.h) * 100}%`,
                }}
              >
                {item.priceMyr.trim() !== "" ? `RM ${item.priceMyr}` : "RM ?"}
              </button>
            ))}
          </div>

          <p className="text-text-secondary text-xs text-center">
            {activeItems.length} product{activeItems.length !== 1 ? "s" : ""} detected ·{" "}
            {pricedCount} priced · tap a badge to edit
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStage("pick");
                setPhotoUrl(null);
                setItems([]);
              }}
              className="flex-1 h-12 text-text-secondary text-sm font-medium rounded-xl border border-border-default"
            >
              Retake
            </button>
            <button
              onClick={handleGenerate}
              disabled={sharing || activeItems.length === 0}
              className="flex-2 h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl disabled:opacity-50"
            >
              {sharing ? "Rendering…" : "Generate & share"}
            </button>
          </div>
          {!isPro && (
            <p className="text-text-muted text-[10px] text-center">
              Free tier adds a small &ldquo;made with KardVault&rdquo; mark — Kad Pro exports clean.
            </p>
          )}
        </div>
      )}

      {/* ── ITEM EDITOR SHEET ── */}
      {editingItem && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/60" onClick={() => setEditing(null)}>
          <div
            className="w-full bg-bg-primary rounded-t-2xl border-t border-border-default p-4 space-y-3 max-h-[75vh] overflow-y-auto"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-9 h-1 rounded-full bg-border-hover mx-auto" />
            <p className="text-text-muted text-[11px]">Detected: {editingItem.label || "unknown"}</p>

            {/* Candidates */}
            {editingItem.candidates.map((c, idx) => (
              <button
                key={c.productId}
                onClick={() =>
                  updateItem(editingItem.id, {
                    chosenIdx: idx,
                    priceMyr: c.priceMyr != null ? String(c.priceMyr) : editingItem.priceMyr,
                  })
                }
                className={`w-full flex items-center gap-3 rounded-xl p-2.5 border text-left ${
                  editingItem.chosenIdx === idx
                    ? "border-border-focus bg-bg-surface-2"
                    : "border-border-default bg-bg-surface"
                }`}
              >
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" className="w-10 h-10 rounded object-contain bg-white/5 shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-bg-surface-2 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-xs font-medium truncate">{c.name}</p>
                  <p className="text-text-muted text-[11px]">
                    {c.priceMyr != null ? `Market ≈ RM ${c.priceMyr}` : "No market price"}
                  </p>
                </div>
              </button>
            ))}
            {editingItem.candidates.length === 0 && (
              <p className="text-text-muted text-xs">
                No catalog match — set a price manually below.
              </p>
            )}

            {/* Price */}
            <div>
              <label className="text-text-secondary text-[11px] block mb-1">Your price (RM)</label>
              <input
                type="number"
                inputMode="decimal"
                value={editingItem.priceMyr}
                onChange={(e) => updateItem(editingItem.id, { priceMyr: e.target.value })}
                className="w-full bg-bg-surface-2 text-text-primary rounded-xl px-3 py-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
                placeholder="0"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => {
                  updateItem(editingItem.id, { removed: true });
                  setEditing(null);
                }}
                className="flex-1 h-11 text-danger text-sm font-medium rounded-xl border border-danger/30"
              >
                Remove
              </button>
              <button
                onClick={() => setEditing(null)}
                className="flex-2 h-11 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Canvas renderer ─────────────────────────────────────────────────────────

async function renderPricedImage(
  photoUrl: string,
  items: ReviewItem[],
  opts: { watermark: boolean; handle: string | null }
): Promise<Blob> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not load photo"));
    img.src = photoUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const fontSize = Math.max(20, Math.round(img.width * 0.032));
  const padX = fontSize * 0.7;
  const padY = fontSize * 0.42;

  for (const item of items) {
    const priceText = item.priceMyr.trim() !== "" ? `RM ${item.priceMyr.trim()}` : "RM ?";
    ctx.font = `700 ${fontSize}px -apple-system, system-ui, sans-serif`;
    const textW = ctx.measureText(priceText).width;
    const pillW = textW + padX * 2;
    const pillH = fontSize + padY * 2;

    // Bottom-centre of the product's box, clamped inside the image
    let cx = (item.box.x + item.box.w / 2) * img.width;
    let by = (item.box.y + item.box.h) * img.height;
    cx = Math.max(pillW / 2 + 8, Math.min(img.width - pillW / 2 - 8, cx));
    by = Math.max(pillH + 8, Math.min(img.height - 8, by));

    const x = cx - pillW / 2;
    const y = by - pillH;
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, pillH / 2);
    ctx.fillStyle = "rgba(13, 12, 18, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(124, 107, 181, 0.9)";
    ctx.lineWidth = Math.max(2, fontSize * 0.08);
    ctx.stroke();

    ctx.fillStyle = "#E4DFF0";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(priceText, cx, y + pillH / 2 + fontSize * 0.05);
  }

  // Footer: vendor handle + watermark
  const footSize = Math.max(14, Math.round(img.width * 0.02));
  ctx.font = `600 ${footSize}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  if (opts.handle) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = footSize * 0.4;
    ctx.fillText(`DM to buy · ${opts.handle}`, footSize, img.height - footSize * 0.8);
    ctx.shadowBlur = 0;
  }
  if (opts.watermark) {
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = footSize * 0.4;
    ctx.fillText("made with KardVault", img.width - footSize, img.height - footSize * 0.8);
    ctx.shadowBlur = 0;
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Render failed"))),
      "image/jpeg",
      0.9
    );
  });
}
