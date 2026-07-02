import type { CatalogProvider, Game } from "./types";
import { PokemonCatalogProvider } from "./pokemon";

export type { Card, CatalogProvider, CropSpec, FuzzyFields, Game, ParsedId } from "./types";

const providers: Partial<Record<Game, CatalogProvider>> = {
  pokemon: new PokemonCatalogProvider(),
  // Rollout order (CLAUDE-enhance.md §6): riftbound → mtg (Scryfall) → yugioh (YGOPRODeck)
};

export function getCatalogProvider(game: Game = "pokemon"): CatalogProvider {
  const provider = providers[game];
  if (!provider) {
    throw new Error(`No catalog provider registered for game "${game}"`);
  }
  return provider;
}
