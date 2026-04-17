const PATTERN = /^\s*(PSA|BGS|CGC|ACE|SGC)\s*(\d+(?:\.\d+)?)\s*$/i;

export type Grading = {
  gradingCompany: string;
  grade: string;
};

export function parseGrading(input: string | null | undefined): Grading | null {
  if (!input) return null;
  const match = input.match(PATTERN);
  if (!match) return null;
  return {
    gradingCompany: match[1].toUpperCase(),
    grade: match[2],
  };
}
