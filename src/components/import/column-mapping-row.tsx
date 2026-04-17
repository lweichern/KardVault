"use client";

import type { ColumnMapping, KardVaultField } from "@/lib/import/types";
import { FIELD_LABELS } from "@/lib/import/types";

type Props = {
  mapping: ColumnMapping;
  onChange: (field: KardVaultField | "skip") => void;
};

const FIELD_OPTIONS: Array<KardVaultField | "skip"> = [
  "card_name",
  "set",
  "card_number",
  "sell_price",
  "buy_price",
  "condition",
  "quantity",
  "grading",
  "skip",
];

export function ColumnMappingRow({ mapping, onChange }: Props) {
  const icon =
    mapping.confidence === "header" || (mapping.confidence === "pattern" && mapping.field !== "skip") ? (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/20 text-success">✓</span>
    ) : mapping.field === "skip" ? (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-bg-hover text-text-muted">–</span>
    ) : (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-800 text-primary-200">?</span>
    );

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[rgba(124,107,181,0.12)] bg-bg-surface p-3">
      <div className="flex-shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{mapping.columnName}</div>
        <div className="truncate text-xs text-text-muted">
          {mapping.sampleValues.slice(0, 3).join(" · ") || "—"}
        </div>
        {mapping.confidence === "header" && (
          <div className="mt-1 inline-block rounded bg-primary-800/60 px-1.5 py-0.5 text-[10px] text-primary-200">
            Auto-detected
          </div>
        )}
        {mapping.confidence === "pattern" && mapping.field !== "skip" && (
          <div className="mt-1 inline-block rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">
            Guessed from data
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-text-muted">→</div>
      <select
        value={mapping.field}
        onChange={(e) => onChange(e.target.value as KardVaultField | "skip")}
        className="flex-shrink-0 rounded-md border border-[rgba(124,107,181,0.25)] bg-bg-surface-2 px-2 py-1.5 text-sm"
      >
        {FIELD_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt === "skip" ? "Skip" : FIELD_LABELS[opt]}
          </option>
        ))}
      </select>
    </div>
  );
}
