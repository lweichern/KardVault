export interface RawSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  ptcgoCode?: string;
  releaseDate: string;
  images: { symbol: string; logo: string };
}

export interface RawCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  evolvesTo?: string[];
  set?: { id: string; name: string; series: string };
  number: string;
  rarity?: string;
  artist?: string;
  attacks?: {
    name: string;
    cost: string[];
    convertedEnergyCost: number;
    damage: string;
    text: string;
  }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  retreatCost?: string[];
  convertedRetreatCost?: number;
  rules?: string[];
  abilities?: { name: string; text: string; type: string }[];
  flavorText?: string;
  images?: { small: string; large: string };
  nationalPokedexNumbers?: number[];
  legalities?: {
    standard?: string;
    expanded?: string;
    unlimited?: string;
  };
  regulationMark?: string;
}
