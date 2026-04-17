"use client";

import type { ImportSessionState } from "@/lib/import/types";

type Rule = ImportSessionState["batchPricingRule"];

type Props = {
  value: Rule;
  onChange: (rule: Rule) => void;
};

const PRESETS: Array<{ label: string; rule: Rule }> = [
  { label: "At market", rule: "market" },
  { label: "90% mkt", rule: "0.9" },
  { label: "80% mkt", rule: "0.8" },
];

export function BatchPricingSelector({ value, onChange }: Props) {
  const isCustom = typeof value === "number";
  const customMultiplier = isCustom ? (value as number) : 1;
  return (
    <div className="rounded-xl border border-[rgba(124,107,181,0.12)] bg-bg-surface p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Batch pricing rule</div>
      <div className="mb-3 text-xs text-text-secondary">
        Your file didn&apos;t include a sell-price column. Choose how to set asking prices.
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.rule)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              value === p.rule ? "bg-primary-400 text-text-on-primary" : "bg-bg-surface-2 text-text-primary"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => onChange(customMultiplier)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            isCustom ? "bg-primary-400 text-text-on-primary" : "bg-bg-surface-2 text-text-primary"
          }`}
        >
          Custom
        </button>
        {isCustom && (
          <input
            type="number"
            step="0.05"
            min="0.5"
            max="2"
            value={customMultiplier}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n >= 0.5 && n <= 2) onChange(n);
            }}
            className="w-20 rounded-md border border-[rgba(124,107,181,0.25)] bg-bg-surface-2 px-2 py-1.5 text-sm"
          />
        )}
      </div>
    </div>
  );
}
