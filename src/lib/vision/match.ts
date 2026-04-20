import { createClient } from "@supabase/supabase-js";
import type { ScanResult, MatchResult, Card } from "./types";
import type { Database } from "@/types/database";

function getSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function matchCard(scanResult: ScanResult): Promise<MatchResult> {
  const supabase = getSupabase();
  const { card_number, card_name, set_name } = scanResult;

  // Priority 1: Match by card number
  if (card_number) {
    const { data: byNumber } = await supabase
      .from("cards")
      .select("*")
      .ilike("number", card_number);

    if (byNumber && byNumber.length === 1) {
      return { match: byNumber[0] as Card, confidence: "exact" };
    }

    if (byNumber && byNumber.length > 1 && set_name) {
      const filtered = (byNumber as Card[]).filter(
        (c) => c.set_name.toLowerCase() === set_name.toLowerCase()
      );

      if (filtered.length === 1) {
        return { match: filtered[0], confidence: "exact" };
      }
      if (filtered.length > 1) {
        return { match: filtered[0], candidates: filtered, confidence: "high" };
      }
    }

    if (byNumber && byNumber.length > 1) {
      return {
        match: byNumber[0] as Card,
        candidates: byNumber as Card[],
        confidence: "high",
      };
    }
  }

  // Priority 2: Match by card name + set name
  if (card_name && set_name) {
    const { data: byNameAndSet } = await supabase
      .from("cards")
      .select("*")
      .ilike("name", `%${card_name}%`)
      .ilike("set_name", `%${set_name}%`);

    if (byNameAndSet && byNameAndSet.length === 1) {
      return { match: byNameAndSet[0] as Card, confidence: "high" };
    }

    if (byNameAndSet && byNameAndSet.length > 1) {
      return {
        match: byNameAndSet[0] as Card,
        candidates: byNameAndSet as Card[],
        confidence: "medium",
      };
    }
  }

  // Priority 3: Match by card name only
  if (card_name) {
    const { data: byName } = await supabase
      .from("cards")
      .select("*")
      .ilike("name", `%${card_name}%`)
      .order("set_id", { ascending: false });

    if (byName && byName.length > 0) {
      return {
        match: byName[0] as Card,
        candidates: byName as Card[],
        confidence: "low",
      };
    }
  }

  // Priority 4: No match
  return { match: null, confidence: "none" };
}
