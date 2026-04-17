"use client";

import Image from "next/image";
import type { MatchResult } from "@/lib/import/types";

type Props = { result: MatchResult };

export function MatchResultRow({ result }: Props) {
  const top = result.candidates[0];
  if (result.status === "matched" && top) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-bg-surface p-3">
        {top.imageSmall ? (
          <Image src={top.imageSmall} alt="" width={40} height={56} className="rounded" />
        ) : (
          <div className="h-14 w-10 rounded bg-bg-hover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{top.name}</div>
          <div className="truncate text-xs text-text-secondary">
            {top.setName} · #{top.cardNumber}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-xs font-medium text-success">Matched</div>
          <div className="text-[10px] text-text-muted">{Math.round(top.score * 100)}% match</div>
        </div>
      </div>
    );
  }
  if (result.status === "uncertain" && top) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-bg-surface p-3">
        {top.imageSmall ? (
          <Image src={top.imageSmall} alt="" width={40} height={56} className="rounded" />
        ) : (
          <div className="h-14 w-10 rounded bg-bg-hover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            &ldquo;{result.rawCardName}&rdquo; → {top.name}?
          </div>
          <div className="truncate text-xs text-text-secondary">{top.setName}</div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-xs font-medium text-warning">Uncertain</div>
          <div className="text-[10px] text-text-muted">{Math.round(top.score * 100)}% match</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-bg-surface p-3">
      <div className="h-14 w-10 rounded bg-bg-hover" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{result.rawCardName || "(empty name)"}</div>
        <div className="truncate text-xs text-text-secondary">No match in database</div>
      </div>
      <div className="flex-shrink-0 text-right text-xs font-medium text-danger">Not found</div>
    </div>
  );
}
