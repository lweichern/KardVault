"use client";

import { useRef, useState, useCallback } from "react";
import { toPng } from "html-to-image";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

interface SalesReportModalProps {
  vendorName: string;
  salesCount: number;
  revenue: number;
  avgMarginPct: number | null;
  bestSeller: { card: Card; quantity: number } | null;
  onClose: () => void;
}

export function SalesReportModal({
  vendorName,
  salesCount,
  revenue,
  avgMarginPct,
  bestSeller,
  onClose,
}: SalesReportModalProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const dateStr = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const generateImage = useCallback(async () => {
    if (!reportRef.current) return;
    setGenerating(true);
    try {
      const dataUrl = await toPng(reportRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 1,
      });
      setImageUrl(dataUrl);
    } catch {
      // Silently fail — user can retry
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!imageUrl) return;
    const blob = await (await fetch(imageUrl)).blob();
    const file = new File([blob], "kardvault-report.png", {
      type: "image/png",
    });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    }
  }, [imageUrl]);

  const handleSave = useCallback(() => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `kardvault-report-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }, [imageUrl]);

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-bg-surface rounded-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-text-primary font-semibold text-sm">
            Today&apos;s Report
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div className="p-4">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Sales report"
              className="w-full rounded-xl"
            />
          ) : (
            <div className="flex items-center justify-center h-48 bg-bg-surface-2 rounded-xl">
              {generating ? (
                <p className="text-text-muted text-sm">Generating...</p>
              ) : (
                <button
                  onClick={generateImage}
                  className="px-6 py-2.5 bg-primary-400 text-text-on-primary rounded-xl text-sm font-medium"
                >
                  Generate Report
                </button>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {imageUrl && (
          <div className="flex gap-2 px-4 pb-4">
            {canShare && (
              <button
                onClick={handleShare}
                className="flex-1 h-11 bg-primary-400 text-text-on-primary rounded-xl text-sm font-medium"
              >
                Share
              </button>
            )}
            <button
              onClick={handleSave}
              className={`${
                canShare ? "flex-1" : "w-full"
              } h-11 bg-bg-surface-2 text-text-primary rounded-xl text-sm font-medium border border-border-default`}
            >
              Save Image
            </button>
          </div>
        )}
      </div>

      {/* Hidden report template for html-to-image */}
      <div className="fixed" style={{ left: "-9999px", top: 0 }}>
        <div
          ref={reportRef}
          style={{
            width: 1080,
            height: 1920,
            background: "linear-gradient(180deg, #15141C 0%, #0D0C12 100%)",
            padding: 80,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {/* Logo */}
          <div style={{ marginBottom: 60 }}>
            <span style={{ fontSize: 48, fontWeight: 700, color: "#E4DFF0" }}>
              Kard
            </span>
            <span style={{ fontSize: 48, fontWeight: 700, color: "#7C6BB5" }}>
              Vault
            </span>
          </div>

          {/* Title */}
          <p
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: "#7A7890",
              textTransform: "uppercase",
              letterSpacing: 4,
              marginBottom: 12,
            }}
          >
            Bazaar Day Report
          </p>
          <p style={{ fontSize: 32, color: "#7A7890", marginBottom: 80 }}>
            {dateStr}
          </p>

          {/* Stats grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              marginBottom: 80,
            }}
          >
            <StatBox label="Cards Sold" value={String(salesCount)} />
            <StatBox
              label="Revenue"
              value={`RM ${revenue.toLocaleString("en", { maximumFractionDigits: 0 })}`}
            />
            <StatBox
              label="Avg Margin"
              value={avgMarginPct != null ? `${avgMarginPct.toFixed(0)}%` : "—"}
            />
            <StatBox
              label="Best Seller"
              value={bestSeller?.card.name ?? "—"}
            />
          </div>

          {/* Vendor name + URL */}
          <div style={{ marginTop: "auto" }}>
            <p
              style={{ fontSize: 32, fontWeight: 600, color: "#E4DFF0", marginBottom: 12 }}
            >
              {vendorName}
            </p>
            <p style={{ fontSize: 28, color: "#7A7890" }}>kardvault.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(124,107,181,0.08)",
        borderRadius: 24,
        padding: "36px 32px",
      }}
    >
      <p
        style={{
          fontSize: 24,
          color: "#7A7890",
          textTransform: "uppercase",
          letterSpacing: 2,
          marginBottom: 12,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 56,
          fontWeight: 700,
          color: "#E4DFF0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </p>
    </div>
  );
}
