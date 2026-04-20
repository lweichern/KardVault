import type { Database } from "@/types/database";

export type Card = Database["public"]["Tables"]["cards"]["Row"];

export interface ScanResult {
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  hp: string | null;
  rarity: string | null;
  card_type: string | null;
  subtypes: string[] | null;
  regulation_mark: string | null;
  confidence: "high" | "medium" | "low";
  is_graded: boolean;
  grading_company: string | null;
  grade: string | null;
  subgrades: Record<string, string> | null;
  cert_number: string | null;
}

export interface MatchResult {
  match: Card | null;
  candidates?: Card[];
  confidence: "exact" | "high" | "medium" | "low" | "none";
}

export interface IdentifyResult {
  scan: ScanResult;
  match: MatchResult;
  latency_ms: number;
}

export interface QualityResult {
  ok: boolean;
  reason?: string;
}

export interface VisionProvider {
  name: string;
  identify(imageBase64: string): Promise<ScanResult>;
}
