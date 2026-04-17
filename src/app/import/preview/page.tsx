"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { loadImportState, saveImportState, clearImportState } from "@/lib/import/session-state";
import { matchRows } from "@/lib/import/matcher";
import { BatchPricingSelector } from "@/components/import/batch-pricing-selector";
import { MatchResultRow } from "@/components/import/match-result-row";
import type { ImportSessionState, MatchResult } from "@/lib/import/types";

type Filter = "all" | "matched" | "uncertain" | "not_found";

export default function PreviewPage() {
  return (
    <Suspense>
      <PreviewContent />
    </Suspense>
  );
}

function PreviewContent() {
  const router = useRouter();
  const params = useSearchParams();
  const importId = params.get("id");
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);
  const supabase = createClient();

  const [state, setState] = useState<ImportSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [currentCount, setCurrentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!vendor) return;
    supabase
      .from("inventory")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendor.id)
      .then(({ count }) => setCurrentCount(count ?? 0));
  }, [vendor, supabase]);

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
    if (s.matchResults.length === 0) {
      matchRows(supabase, s.parsedFile, s.mappings)
        .then((results) => {
          const updated = { ...s, matchResults: results };
          saveImportState(updated);
          setState(updated);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Matching failed."))
        .finally(() => setLoading(false));
    } else {
      setState(s);
      setLoading(false);
    }
  }, [importId, router, supabase]);

  const counts = useMemo(() => {
    if (!state) return { all: 0, matched: 0, uncertain: 0, not_found: 0 };
    return state.matchResults.reduce(
      (acc, r) => {
        acc.all++;
        acc[r.status]++;
        return acc;
      },
      { all: 0, matched: 0, uncertain: 0, not_found: 0 } as Record<Filter, number>
    );
  }, [state]);

  const isFreeTier = vendor?.tier === "free";
  const FREE_CAP = 50;
  const remainingCapacity = isFreeTier && currentCount !== null ? Math.max(0, FREE_CAP - currentCount) : Infinity;
  const willTruncate = counts.matched > remainingCapacity;
  const toImportCount = Math.min(counts.matched, remainingCapacity);

  const hasSellPriceColumn = state?.mappings.some((m) => m.field === "sell_price") ?? false;

  const setRule = (rule: ImportSessionState["batchPricingRule"]) => {
    if (!state) return;
    const updated = { ...state, batchPricingRule: rule };
    saveImportState(updated);
    setState(updated);
  };

  const filtered: MatchResult[] = useMemo(() => {
    if (!state) return [];
    if (filter === "all") return state.matchResults;
    return state.matchResults.filter((r) => r.status === filter);
  }, [state, filter]);

  const handleImport = async () => {
    if (!state || !vendor) return;
    setImporting(true);
    setError(null);
    try {
      const matched = state.matchResults
        .filter((r) => r.status === "matched" && r.selectedCardId)
        .slice(0, remainingCapacity);
      const rows = matched.map((r) => {
        const cand = r.candidates.find((c) => c.id === r.selectedCardId) ?? r.candidates[0];
        const sellPrice = r.mappedFields.sellPriceRm ?? computeSellPrice(cand.marketPriceRm, state.batchPricingRule);
        return {
          vendor_id: vendor.id,
          card_id: r.selectedCardId!,
          condition: r.mappedFields.condition,
          quantity: r.mappedFields.quantity,
          sell_price_rm: sellPrice,
          buy_price_rm: r.mappedFields.buyPriceRm,
          grading_company: r.mappedFields.gradingCompany,
          grade: r.mappedFields.grade,
        };
      });
      if (rows.length === 0) {
        setError("No matched rows to import.");
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { error: insertError } = await db.from("inventory").upsert(rows, {
        onConflict: "vendor_id,card_id,condition,grading_company,grade",
      });
      if (insertError) throw insertError;
      clearImportState(state.importId);
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-text-secondary">Matching cards…</div>;
  if (!state) return null;
  if (imported) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8 text-center">
        <div className="mb-4 text-2xl">🎉</div>
        <h1 className="text-lg font-semibold">Import complete</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Added {counts.matched} cards to your inventory.
        </p>
        <Link href="/inventory" className="mt-6 inline-block rounded-lg bg-primary-400 px-6 py-3 text-sm font-medium text-text-on-primary">
          Back to inventory
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href={`/import/mapping?id=${state.importId}`} aria-label="Back" className="text-text-secondary">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">Review matches</h1>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <SummaryPill label="Matched" count={counts.matched} tone="success" />
        <SummaryPill label="Uncertain" count={counts.uncertain} tone="warning" />
        <SummaryPill label="Not found" count={counts.not_found} tone="danger" />
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {(["all", "matched", "uncertain", "not_found"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
              filter === f ? "bg-primary-400 text-text-on-primary" : "bg-bg-surface-2 text-text-primary"
            }`}
          >
            {f === "all" ? "All" : f === "not_found" ? "Not found" : f[0].toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((r) => (
          <MatchResultRow key={r.rowIndex} result={r} />
        ))}
      </div>

      {!hasSellPriceColumn && (
        <div className="mt-6">
          <BatchPricingSelector value={state.batchPricingRule} onChange={setRule} />
        </div>
      )}

      {willTruncate && (
        <div className="mt-4 rounded-lg border border-primary-600 bg-primary-800/40 p-3 text-sm">
          <div className="mb-1 font-medium text-primary-200">Free tier holds 50 cards</div>
          <div className="text-xs text-text-secondary">
            You have {currentCount} cards. Importing will add the first {remainingCapacity} matched cards.
            {" "}
            <Link href="/upgrade" className="underline">Upgrade to Pro</Link> for unlimited.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <button
        disabled={importing || toImportCount === 0}
        onClick={handleImport}
        className="mt-6 w-full rounded-lg bg-primary-400 py-3 font-medium text-text-on-primary disabled:opacity-40"
      >
        {importing ? "Importing…" : `Import ${toImportCount} matched cards`}
      </button>

      <p className="mt-3 text-center text-xs text-text-muted">
        {counts.uncertain} uncertain + {counts.not_found} not found will be skipped. You can add them manually later.
      </p>
    </div>
  );
}

function SummaryPill({ label, count, tone }: { label: string; count: number; tone: "success" | "warning" | "danger" }) {
  const bg = tone === "success" ? "bg-success/10 border-success/30" : tone === "warning" ? "bg-warning/10 border-warning/30" : "bg-danger/10 border-danger/30";
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger";
  return (
    <div className={`rounded-xl border ${bg} p-2`}>
      <div className={`text-lg font-semibold ${color}`}>{count}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
    </div>
  );
}

function computeSellPrice(marketPriceRm: number | null, rule: ImportSessionState["batchPricingRule"]): number {
  const base = marketPriceRm ?? 0;
  if (rule === "market") return base;
  if (rule === "0.9") return +(base * 0.9).toFixed(2);
  if (rule === "0.8") return +(base * 0.8).toFixed(2);
  return +(base * rule).toFixed(2);
}
