// Majority vote over a burst of identify results (CLAUDE-enhance.md §4.4).
// Voting kills transient glare/blur failures: 2-of-3 frames agreeing on the
// same card wins; anything less goes to the confirm UI.

import type { IdentifyResultItem } from "./api-types";

export function majorityVote(results: IdentifyResultItem[]): IdentifyResultItem | null {
  const votes = new Map<string, number>();
  for (const r of results) {
    if (r.card) votes.set(r.card.id, (votes.get(r.card.id) ?? 0) + 1);
  }

  const needed = Math.floor(results.length / 2) + 1;
  let winnerId: string | null = null;
  for (const [id, count] of votes) {
    if (count >= needed) winnerId = id;
  }
  if (!winnerId) return null;

  const winners = results.filter((r) => r.card?.id === winnerId);
  // Prefer the auto-accepted instance (its telemetry/tier is the meaningful one)
  return winners.find((r) => r.autoAccepted) ?? winners[0];
}
