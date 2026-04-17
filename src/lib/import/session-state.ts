import type { ImportSessionState } from "./types";

const PREFIX = "kv_import_";
const EXPIRY_MS = 24 * 3600 * 1000;

export function newImportId(): string {
  return crypto.randomUUID();
}

export function saveImportState(state: ImportSessionState): void {
  sessionStorage.setItem(PREFIX + state.importId, JSON.stringify(state));
}

export function loadImportState(id: string): ImportSessionState | null {
  const raw = sessionStorage.getItem(PREFIX + id);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ImportSessionState;
    if (Date.now() - parsed.createdAt > EXPIRY_MS) {
      clearImportState(id);
      return null;
    }
    return parsed;
  } catch {
    clearImportState(id);
    return null;
  }
}

export function clearImportState(id: string): void {
  sessionStorage.removeItem(PREFIX + id);
}
