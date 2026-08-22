/**
 * Pure column-reorder logic for the Attendance sheet migration (no I/O). Kept
 * separate so the mapping is unit-testable and the script only does the Sheets
 * reads/writes around it.
 *
 * Guarantees:
 *  - Columns are matched by HEADER NAME → source index (never a fixed position).
 *  - Row order and cell values are preserved exactly.
 *  - Unknown/unnamed extra columns are never dropped — they are kept, in their
 *    original left-to-right order, AFTER the target columns.
 *  - Missing target columns are added as blank cells (never duplicated).
 */

export interface ReorderResult {
  /** Final header row: target columns first, then any preserved extras. */
  finalHeader: string[];
  /** Full sheet matrix to write back: [finalHeader, ...reorderedDataRows]. */
  values: unknown[][];
  /** Reordered data rows only (header excluded). */
  rows: unknown[][];
  /** Target columns not present in the source (added as blank). */
  missingColumns: string[];
  /** Columns not claimed by a target column, preserved at the end. */
  extraColumns: { index: number; name: string }[];
  /** Target names that appear more than once in the source (ambiguous). */
  duplicateTargets: string[];
  /** Number of data rows (excludes the header). */
  rowCount: number;
}

function cellAt(row: unknown[], idx: number): unknown {
  return idx === -1 || idx >= row.length ? '' : (row[idx] ?? '');
}

/**
 * Reorder `values` (a [header, ...rows] matrix) into `targetHeader` order.
 * Returns everything the migration script needs to report and to write.
 */
export function reorderAttendanceMatrix(
  values: readonly unknown[][],
  targetHeader: readonly string[],
): ReorderResult {
  const header = (values[0] ?? []).map((v) => String(v ?? '').trim());
  const dataRows = values.slice(1);
  const sourceWidth = Math.max(header.length, ...dataRows.map((r) => r.length), 0);

  const duplicateTargets = targetHeader.filter(
    (name) => header.filter((h) => h === name).length > 1,
  );

  const targetIndices = targetHeader.map((name) => header.indexOf(name));
  const usedIndices = new Set(targetIndices.filter((i) => i !== -1));

  const extraIndices: number[] = [];
  for (let i = 0; i < sourceWidth; i++) if (!usedIndices.has(i)) extraIndices.push(i);

  const missingColumns = targetHeader.filter((_, i) => targetIndices[i] === -1);
  const extraColumns = extraIndices.map((i) => ({ index: i, name: header[i] ?? '' }));

  const finalHeader = [...targetHeader, ...extraIndices.map((i) => header[i] ?? '')];

  const rows = dataRows.map((row) => [
    ...targetIndices.map((idx) => cellAt(row, idx)),
    ...extraIndices.map((idx) => cellAt(row, idx)),
  ]);

  return {
    finalHeader,
    values: [finalHeader, ...rows],
    rows,
    missingColumns,
    extraColumns,
    duplicateTargets,
    rowCount: dataRows.length,
  };
}
