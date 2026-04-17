export type KardVaultField =
  | "card_name"
  | "set"
  | "card_number"
  | "sell_price"
  | "buy_price"
  | "condition"
  | "quantity"
  | "grading";

export type ParsedFile = {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  fileName: string;
  sizeBytes: number;
};

export type ColumnMapping = {
  columnName: string;
  field: KardVaultField | "skip";
  confidence: "header" | "pattern" | "manual";
  sampleValues: string[];
};

export type MatchResult = {
  rowIndex: number;
  rawCardName: string;
  status: "matched" | "uncertain" | "not_found";
  candidates: CardCandidate[];
  selectedCardId: string | null;
  mappedFields: {
    sellPriceRm: number | null;
    buyPriceRm: number | null;
    condition: "NM" | "LP" | "MP" | "HP" | "DMG";
    quantity: number;
    gradingCompany: string | null;
    grade: string | null;
  };
};

export type CardCandidate = {
  id: string;
  name: string;
  setName: string;
  cardNumber: string;
  imageSmall: string | null;
  marketPriceRm: number | null;
  score: number;
};

export type ImportSessionState = {
  importId: string;
  parsedFile: ParsedFile;
  mappings: ColumnMapping[];
  matchResults: MatchResult[];
  batchPricingRule: "market" | "0.9" | "0.8" | number;
  createdAt: number;
};

export const FIELD_LABELS: Record<KardVaultField, string> = {
  card_name: "Card name",
  set: "Set",
  card_number: "Card number",
  sell_price: "Sell price",
  buy_price: "Buy price",
  condition: "Condition",
  quantity: "Quantity",
  grading: "Grading",
};
