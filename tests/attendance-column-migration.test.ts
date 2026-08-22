import { describe, it, expect } from 'vitest';
import { reorderAttendanceMatrix } from '@/lib/attendance/column-migration';

// The current live order (as written by the repository) and the requested target.
const CURRENT = ['timestamp', 'date', 'userId', 'displayName', 'type', 'time', 'lat', 'lng', 'summary', 'clientRequestId', 'empId', 'employmentType', 'workHours'];
const TARGET = ['timestamp', 'date', 'empId', 'displayName', 'type', 'time', 'workHours', 'lat', 'lng', 'summary', 'employmentType', 'userId', 'clientRequestId'];

/** A row whose every cell is a sentinel tied to its column name. */
function sentinelRow(header: string[], suffix: string): string[] {
  return header.map((h) => `${h}:${suffix}`);
}

describe('reorderAttendanceMatrix — mapping fidelity', () => {
  it('#12 moves each column WITH its data (no value ends up under the wrong header)', () => {
    const values = [CURRENT, sentinelRow(CURRENT, 'r1')];
    const out = reorderAttendanceMatrix(values, TARGET);
    expect(out.finalHeader).toEqual(TARGET);
    // Every target cell must equal the sentinel for THAT column name.
    out.finalHeader.forEach((name, i) => {
      expect(out.rows[0][i]).toBe(`${name}:r1`);
    });
  });

  it('#11 preserves row order exactly', () => {
    const values = [CURRENT, sentinelRow(CURRENT, 'A'), sentinelRow(CURRENT, 'B'), sentinelRow(CURRENT, 'C')];
    const out = reorderAttendanceMatrix(values, TARGET);
    const tsCol = out.finalHeader.indexOf('timestamp');
    expect(out.rows.map((r) => r[tsCol])).toEqual(['timestamp:A', 'timestamp:B', 'timestamp:C']);
  });

  it('empId / userId / workHours land in the target positions', () => {
    const values = [CURRENT, sentinelRow(CURRENT, 'r1')];
    const out = reorderAttendanceMatrix(values, TARGET);
    expect(out.finalHeader.indexOf('empId')).toBe(2);
    expect(out.finalHeader.indexOf('workHours')).toBe(6);
    expect(out.finalHeader.indexOf('userId')).toBe(11);
    expect(out.rows[0][2]).toBe('empId:r1');
    expect(out.rows[0][6]).toBe('workHours:r1');
    expect(out.rows[0][11]).toBe('userId:r1');
  });

  it('#10 preserves unknown extra columns at the end (never dropped)', () => {
    const src = [...CURRENT, 'legacyNote'];
    const values = [src, [...sentinelRow(CURRENT, 'r1'), 'keep-me']];
    const out = reorderAttendanceMatrix(values, TARGET);
    expect(out.finalHeader).toEqual([...TARGET, 'legacyNote']);
    expect(out.extraColumns).toEqual([{ index: 13, name: 'legacyNote' }]);
    expect(out.rows[0][out.finalHeader.indexOf('legacyNote')]).toBe('keep-me');
  });

  it('preserves an UNNAMED trailing extra column too', () => {
    const values = [CURRENT, [...sentinelRow(CURRENT, 'r1'), 'orphan']];
    const out = reorderAttendanceMatrix(values, TARGET);
    // Header had 13 names; the orphan value sits at source index 13 (no header).
    expect(out.finalHeader).toEqual([...TARGET, '']);
    expect(out.rows[0][out.finalHeader.length - 1]).toBe('orphan');
  });

  it('adds a MISSING target column as blank (not duplicated) and reports it', () => {
    const src = CURRENT.filter((h) => h !== 'workHours'); // legacy sheet without workHours
    const values = [src, sentinelRow(src, 'r1')];
    const out = reorderAttendanceMatrix(values, TARGET);
    expect(out.missingColumns).toEqual(['workHours']);
    expect(out.finalHeader).toEqual(TARGET);
    expect(out.finalHeader.filter((h) => h === 'workHours')).toHaveLength(1);
    expect(out.rows[0][out.finalHeader.indexOf('workHours')]).toBe(''); // blank, safe
  });

  it('flags duplicate target headers (ambiguous) without building a bad mapping', () => {
    const src = [...CURRENT, 'empId']; // empId appears twice
    const out = reorderAttendanceMatrix([src, sentinelRow(src, 'r1')], TARGET);
    expect(out.duplicateTargets).toContain('empId');
  });

  it('keeps numeric and date-serial cells as-is (values unchanged)', () => {
    const row: unknown[] = CURRENT.map(() => '');
    row[CURRENT.indexOf('lat')] = 13.736717;
    row[CURRENT.indexOf('date')] = 46875; // legacy date-serial (number)
    const out = reorderAttendanceMatrix([CURRENT, row], TARGET);
    expect(out.rows[0][out.finalHeader.indexOf('lat')]).toBe(13.736717);
    expect(out.rows[0][out.finalHeader.indexOf('date')]).toBe(46875);
  });

  it('rowCount excludes the header', () => {
    const out = reorderAttendanceMatrix([CURRENT, sentinelRow(CURRENT, 'A'), sentinelRow(CURRENT, 'B')], TARGET);
    expect(out.rowCount).toBe(2);
  });
});
