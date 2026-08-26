import { parse as parseCsv } from "csv-parse";
import * as XLSX from "xlsx";
import { Readable } from "node:stream";

export type ParsedFile = {
  headers: string[];
  rows: Record<string, string>[];
};

/**
 * Parse an uploaded lead file into headers + row objects.
 *
 * CSV is stream-parsed so large vendor lists (100k+ rows) never sit fully in
 * memory as a giant string. XLSX (SheetJS) is inherently in-memory — acceptable
 * for the spreadsheet sizes Excel realistically holds; steer very large lists to
 * CSV. Both paths converge on the same shape for the shared validation gate.
 */
export async function parseLeadFile(
  buffer: Buffer,
  filename: string,
): Promise<ParsedFile> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseXlsx(buffer);
  }
  return parseCsvStream(buffer);
}

function parseCsvStream(buffer: Buffer): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    let headers: string[] = [];

    const parser = parseCsv({
      columns: (h: string[]) => {
        headers = h.map((c) => c.trim());
        return headers;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    parser.on("readable", () => {
      let record: Record<string, string> | null;
      while ((record = parser.read() as Record<string, string> | null)) {
        rows.push(record);
      }
    });
    parser.on("error", reject);
    parser.on("end", () => resolve({ headers, rows }));

    Readable.from(buffer).pipe(parser);
  });
}

function parseXlsx(buffer: Buffer): ParsedFile {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: "",
    raw: false,
  });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}
