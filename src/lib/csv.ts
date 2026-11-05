/** CSV text is never promoted to a number based on its contents. */
export type CsvCell = string | number | null | undefined;

// Some importers skip whitespace, controls, Unicode format characters or text
// apostrophes before detecting operators (or on save/reopen). Full-width formula
// operators matter in some locales too. Do not rely on a user's own apostrophe.
const FORMULA_START = /^[\s\p{Cc}\p{Cf}']*[=+\-@＝＋－＠]/u;
const LEADING_CONTROL = /^[\s\p{Cc}\p{Cf}]*[\p{Cc}\p{Cf}]/u;
export const CSV_TEXT_GUARD = "\t'";

/** Convert storage/user fields explicitly to text; never infer trusted numbers. */
export function csvText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function csvCell(value: CsvCell): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('CSV numbers must be finite');
    // Only a caller's explicitly typed server number reaches this branch.
    return String(value);
  }
  if (value !== null && value !== undefined && typeof value !== 'string') throw new TypeError('Invalid CSV cell');
  const text = value ?? '';
  // A quoted tab is Excel's resistant guard; the apostrophe also makes the text
  // intent explicit if another importer removes the tab. Both remain CSV data.
  // Do not trim: preserving original spaces/controls matters for fidelity.
  const safe = FORMULA_START.test(text) || LEADING_CONTROL.test(text) ? CSV_TEXT_GUARD + text : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** All rows, including headers, use the same formula protection and quoting. */
export function serializeCsv(rows: readonly (readonly CsvCell[])[], options: { bom?: boolean } = {}): string {
  const columns = rows[0]?.length;
  if (rows.some(row => row.length !== columns)) throw new TypeError('CSV rows must have the same number of columns');
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  return (options.bom ? '\uFEFF' : '') + csv;
}
