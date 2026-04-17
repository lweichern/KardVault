"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadImportState, saveImportState } from "@/lib/import/session-state";
import { ColumnMappingRow } from "@/components/import/column-mapping-row";
import type { ColumnMapping, ImportSessionState, KardVaultField } from "@/lib/import/types";

export default function MappingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const importId = params.get("id");
  const [state, setState] = useState<ImportSessionState | null>(null);

  useEffect(() => {
    if (!importId) {
      router.replace("/import");
      return;
    }
    const s = loadImportState(importId);
    if (!s) {
      router.replace("/import");
      return;
    }
    setState(s);
  }, [importId, router]);

  if (!state) return null;

  const updateField = (idx: number, field: KardVaultField | "skip") => {
    const next = [...state.mappings];
    if (field !== "skip") {
      next.forEach((m, i) => {
        if (i !== idx && m.field === field) {
          next[i] = { ...m, field: "skip", confidence: "manual" };
        }
      });
    }
    next[idx] = { ...next[idx], field, confidence: "manual" };
    const updated = { ...state, mappings: next };
    setState(updated);
    saveImportState(updated);
  };

  const autoDetectedCount = state.mappings.filter(
    (m) => (m.confidence === "header" || m.confidence === "pattern") && m.field !== "skip"
  ).length;

  const hasCardName = state.mappings.some((m) => m.field === "card_name");

  const handleContinue = () => {
    router.push(`/import/preview?id=${state.importId}`);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/import" aria-label="Back" className="text-text-secondary">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold">Map your columns</h1>
        </div>
        <div className="text-xs text-success">{autoDetectedCount} auto-detected</div>
      </div>

      <p className="mb-4 text-xs text-text-muted">
        We detected {state.mappings.length} columns in your file. Confirm or adjust the mapping below.
      </p>

      <div className="space-y-3">
        {state.mappings.map((m, i) => (
          <ColumnMappingRow key={m.columnName} mapping={m} onChange={(f) => updateField(i, f)} />
        ))}
      </div>

      {!hasCardName && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Map at least one column to <strong>Card name</strong> to continue.
        </div>
      )}

      <button
        disabled={!hasCardName}
        onClick={handleContinue}
        className="mt-6 w-full rounded-lg bg-primary-400 py-3 font-medium text-text-on-primary disabled:opacity-40"
      >
        Match {state.parsedFile.rowCount} cards against database
      </button>
    </div>
  );
}
