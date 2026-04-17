"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseFile } from "@/lib/import/parser";
import { detectColumns } from "@/lib/import/column-detector";
import { newImportId, saveImportState } from "@/lib/import/session-state";
import { UploadDropzone } from "@/components/import/upload-dropzone";
import type { ParsedFile } from "@/lib/import/types";

export default function ImportUploadPage() {
  const router = useRouter();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setParsed(null);
    setParsing(true);
    try {
      const result = await parseFile(file);
      setParsed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file.");
    } finally {
      setParsing(false);
    }
  };

  const handleContinue = () => {
    if (!parsed) return;
    const importId = newImportId();
    saveImportState({
      importId,
      parsedFile: parsed,
      mappings: detectColumns(parsed),
      matchResults: [],
      batchPricingRule: "market",
      createdAt: Date.now(),
    });
    router.push(`/import/mapping?id=${importId}`);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/inventory" aria-label="Back" className="text-text-secondary">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">Import inventory</h1>
      </div>

      <UploadDropzone onFileSelected={handleFile} disabled={parsing} />

      {parsing && <div className="mt-4 text-sm text-text-secondary">Parsing…</div>}

      {error && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {parsed && !error && (
        <div className="mt-4 rounded-xl border border-success/40 bg-bg-surface p-4">
          <div className="text-sm font-medium text-text-primary">{parsed.fileName}</div>
          <div className="mt-1 text-xs text-text-secondary">
            {parsed.rowCount} rows · {parsed.headers.length} columns · {Math.round(parsed.sizeBytes / 1024)} KB
          </div>
        </div>
      )}

      <div className="my-6 text-center text-xs text-text-muted">— or start with our template —</div>

      <a
        href="/templates/kardvault-template.csv"
        download
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[rgba(124,107,181,0.25)] py-3 text-sm text-text-primary"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
        </svg>
        Download KardVault CSV template
      </a>

      <button
        disabled={!parsed || parsing}
        onClick={handleContinue}
        className="mt-6 w-full rounded-lg bg-primary-400 py-3 font-medium text-text-on-primary disabled:opacity-40"
      >
        Continue to column mapping
      </button>
    </div>
  );
}
