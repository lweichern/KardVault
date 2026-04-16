"use client";

import { useState } from "react";

const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "ACE"] as const;
export type GradingCompany = (typeof GRADING_COMPANIES)[number];

const GRADES: Record<GradingCompany, string[]> = {
  PSA: ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
  BGS: ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5", "4", "3", "2", "1"],
  CGC: ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5", "4", "3", "2", "1"],
  ACE: ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
};

const GRADE_LABELS: Record<string, string> = {
  "10": "Gem Mint",
  "9.5": "Gem Mint",
  "9": "Mint",
  "8.5": "NM-Mint+",
  "8": "NM-Mint",
  "7.5": "Near Mint+",
  "7": "Near Mint",
  "6.5": "EX-NM+",
  "6": "EX-NM",
  "5": "Excellent",
  "4": "VG-EX",
  "3": "Very Good",
  "2": "Good",
  "1": "Poor",
};

interface GradingSelectorProps {
  isGraded: boolean;
  onToggleGraded: (graded: boolean) => void;
  company: GradingCompany | null;
  onCompanyChange: (company: GradingCompany) => void;
  grade: string;
  onGradeChange: (grade: string) => void;
}

export function GradingSelector({
  isGraded,
  onToggleGraded,
  company,
  onCompanyChange,
  grade,
  onGradeChange,
}: GradingSelectorProps) {
  const [showGrades, setShowGrades] = useState(false);
  const availableGrades = company ? GRADES[company] : [];

  return (
    <div>
      {/* Raw / Graded toggle */}
      <label className="block text-text-secondary text-xs font-medium mb-1.5">
        Type
      </label>
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => onToggleGraded(false)}
          className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
            !isGraded
              ? "bg-primary-400 text-text-on-primary border-primary-400"
              : "bg-bg-surface-2 text-text-secondary border-border-default hover:border-border-hover"
          }`}
        >
          Raw
        </button>
        <button
          type="button"
          onClick={() => onToggleGraded(true)}
          className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
            isGraded
              ? "bg-primary-400 text-text-on-primary border-primary-400"
              : "bg-bg-surface-2 text-text-secondary border-border-default hover:border-border-hover"
          }`}
        >
          Graded
        </button>
      </div>

      {isGraded && (
        <>
          {/* Grading company selector */}
          <label className="block text-text-secondary text-xs font-medium mb-1.5">
            Grading Company
          </label>
          <div className="flex gap-2 mb-3">
            {GRADING_COMPANIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onCompanyChange(c);
                  onGradeChange("");
                  setShowGrades(false);
                }}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  company === c
                    ? "bg-primary-400 text-text-on-primary border-primary-400"
                    : "bg-bg-surface-2 text-text-secondary border-border-default hover:border-border-hover"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Grade selector */}
          {company && (
            <>
              <label className="block text-text-secondary text-xs font-medium mb-1.5">
                Grade
              </label>
              <button
                type="button"
                onClick={() => setShowGrades(!showGrades)}
                className="w-full h-11 bg-bg-surface-2 text-left rounded-xl px-3 text-sm border border-border-default focus:border-border-focus flex items-center justify-between"
              >
                <span className={grade ? "text-text-primary" : "text-text-muted"}>
                  {grade
                    ? `${grade} — ${GRADE_LABELS[grade] ?? ""}`
                    : "Select grade..."}
                </span>
                <svg
                  className={`w-4 h-4 text-text-muted transition-transform ${showGrades ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {showGrades && (
                <div className="mt-1 bg-bg-surface border border-border-default rounded-xl max-h-48 overflow-y-auto">
                  {availableGrades.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        onGradeChange(g);
                        setShowGrades(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-bg-hover transition-colors ${
                        grade === g ? "text-primary-400 font-medium" : "text-text-primary"
                      }`}
                    >
                      <span>{g}</span>
                      <span className="text-text-muted text-xs">
                        {GRADE_LABELS[g] ?? ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
