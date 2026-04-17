"use client";

import { useRef, useState, type DragEvent } from "react";

type Props = {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
};

export function UploadDropzone({ onFileSelected, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        isDragging ? "border-primary-400 bg-bg-surface" : "border-[rgba(124,107,181,0.25)] bg-bg-surface/60"
      } ${disabled ? "opacity-50" : "cursor-pointer"}`}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-800">
        <svg className="h-6 w-6 text-primary-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
        </svg>
      </div>
      <div className="text-base font-medium text-text-primary">Upload your spreadsheet</div>
      <div className="mt-2 text-xs text-text-secondary">
        Supports CSV and Excel (.xlsx) files. We&apos;ll auto-detect your columns.
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
        }}
      />
    </div>
  );
}
