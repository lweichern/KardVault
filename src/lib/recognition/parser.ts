/**
 * Extract a card number from raw OCR text.
 * Returns the cleaned card number string, or null if no recognizable pattern found.
 */
export function parseCardNumber(rawText: string): string | null {
  const text = rawText.replace(/\n/g, " ").trim();

  // Pattern 1: Standard format — 025/198, 1/100, 123/456
  const standard = text.match(/(\d{1,3})\s*\/\s*(\d{2,3})/);
  if (standard) {
    return `${standard[1]}/${standard[2]}`;
  }

  // Pattern 2: Set-prefixed — SV1-025, SV1EN-025, SWSH4-123
  const setPrefixed = text.match(/([A-Z]{2,4}\d*[A-Z]*-\d{2,3})/);
  if (setPrefixed) {
    return setPrefixed[1];
  }

  // Pattern 3: Trainer gallery — TG15/TG30
  const trainerGallery = text.match(/(TG\d+)\s*\/\s*(TG\d+)/);
  if (trainerGallery) {
    return `${trainerGallery[1]}/${trainerGallery[2]}`;
  }

  return null;
}
