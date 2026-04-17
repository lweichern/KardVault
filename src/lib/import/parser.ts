import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedFile } from "./types";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5_000;

const CSV_EXTENSIONS = [".csv"];
const XLSX_EXTENSIONS = [".xlsx"];

export async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large — max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB. Split your file into smaller batches.`
    );
  }
  const name = file.name.toLowerCase();
  const isCsv = CSV_EXTENSIONS.some((ext) => name.endsWith(ext));
  const isXlsx = XLSX_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!isCsv && !isXlsx) {
    throw new Error("Only CSV and Excel files are supported.");
  }

  const parsed = isCsv ? await parseCsv(file) : await parseXlsx(file);

  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    throw new Error(
      "We couldn't find any data in this file. Is the first row a header?"
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    throw new Error(
      `This file has ${parsed.rows.length} rows. Max supported is ${MAX_ROWS.toLocaleString()}. Split your file into smaller batches.`
    );
  }
  return parsed;
}

async function parseCsv(file: File): Promise<ParsedFile> {
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstNewline = text.indexOf("\n");
  if (firstNewline !== -1 && text.slice(0, firstNewline).trim().startsWith("sep=")) {
    text = text.slice(firstNewline + 1);
  }
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields ?? []).map((h) => h.trim());
  const rows = (result.data ?? []).filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== "")
  );
  return {
    headers,
    rows,
    rowCount: rows.length,
    fileName: file.name,
    sizeBytes: file.size,
  };
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error("This Excel file has no sheets.");
  const sheet = wb.Sheets[firstSheetName];
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (aoa.length === 0)
    return { headers: [], rows: [], rowCount: 0, fileName: file.name, sizeBytes: file.size };
  const headers = aoa[0].map((h) => String(h).trim()).filter(Boolean);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((h, idx) => {
      const v = aoa[i][idx];
      const str = v == null ? "" : String(v).trim();
      if (str) hasValue = true;
      row[h] = str;
    });
    if (hasValue) rows.push(row);
  }
  return {
    headers,
    rows,
    rowCount: rows.length,
    fileName: file.name,
    sizeBytes: file.size,
  };
}
