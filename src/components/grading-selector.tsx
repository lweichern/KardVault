"use client";

const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "ACE"] as const;
export type GradingCompany = (typeof GRADING_COMPANIES)[number];

const HAS_HALF_GRADES: Record<GradingCompany, boolean> = {
  PSA: false,
  BGS: true,
  CGC: true,
  ACE: false,
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

function formatGrade(value: number): string {
  return value % 1 === 0 ? value.toString() : value.toFixed(1);
}

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
  const step = company && HAS_HALF_GRADES[company] ? 0.5 : 1;
  const numericGrade = grade ? parseFloat(grade) : 7;

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
                  onGradeChange("10");
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

          {/* Grade slider */}
          {company && (
            <div>
              <label className="block text-text-secondary text-xs font-medium mb-1.5">
                Grade
              </label>
              <div className="flex items-center gap-3">
                <span className="text-text-primary text-sm font-bold w-7 text-center">
                  {grade || "10"}
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={step}
                  value={numericGrade}
                  onChange={(e) => onGradeChange(formatGrade(parseFloat(e.target.value)))}
                  className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-bg-hover [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-400"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
