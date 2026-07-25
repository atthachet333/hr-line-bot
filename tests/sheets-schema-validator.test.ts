import { describe, it, expect } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { validateSheetsSchema } from '@/lib/sheets/schema-validator';
import { LEAVE_REQUEST_COLUMNS } from '@/lib/domain/leave-request';

/** Build a fake Sheets client backed by a name -> header map. */
function fakeSheets(headers: Record<string, string[] | 'missing'>): sheets_v4.Sheets {
  return {
    spreadsheets: {
      values: {
        get: async ({ range }: { range: string }) => {
          const name = range.split('!')[0];
          const h = headers[name];
          if (h === undefined || h === 'missing') {
            throw new Error(`Unable to parse range: ${range}`);
          }
          return { data: { values: [h] } };
        },
      },
    },
  } as unknown as sheets_v4.Sheets;
}

const fullLeave = LEAVE_REQUEST_COLUMNS as string[];

describe('validateSheetsSchema', () => {
  it('passes when all required headers are present', async () => {
    const sheets = fakeSheets({
      LeaveRequests: fullLeave,
      Employees: ['lineUserId', 'employeeId', 'name', 'position'],
      AuditLog: ['timestamp', 'requestId', 'action', 'webhookEventId'],
      // Holidays optional and absent.
      Holidays: 'missing',
    });
    const report = await validateSheetsSchema({ sheets, spreadsheetId: 'x' });
    expect(report.ok).toBe(true);
  });

  it('flags a missing required sheet', async () => {
    const sheets = fakeSheets({
      LeaveRequests: fullLeave,
      Employees: 'missing',
      AuditLog: ['timestamp', 'requestId', 'action', 'webhookEventId'],
      Holidays: 'missing',
    });
    const report = await validateSheetsSchema({ sheets, spreadsheetId: 'x' });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.sheet === 'Employees')?.status).toBe('missing');
  });

  it('flags a header mismatch (missing column)', async () => {
    const sheets = fakeSheets({
      LeaveRequests: fullLeave,
      Employees: ['lineUserId', 'employeeId'], // missing "name"
      AuditLog: ['timestamp', 'requestId', 'action', 'webhookEventId'],
      Holidays: 'missing',
    });
    const report = await validateSheetsSchema({ sheets, spreadsheetId: 'x' });
    const emp = report.checks.find((c) => c.sheet === 'Employees');
    expect(emp?.status).toBe('header_mismatch');
    expect(emp?.missingColumns).toContain('name');
  });

  it('allows an empty LeaveRequests sheet (header auto-created)', async () => {
    const sheets = fakeSheets({
      LeaveRequests: [],
      Employees: ['lineUserId', 'employeeId', 'name'],
      AuditLog: ['timestamp', 'requestId', 'action', 'webhookEventId'],
      Holidays: 'missing',
    });
    const report = await validateSheetsSchema({ sheets, spreadsheetId: 'x' });
    expect(report.checks.find((c) => c.sheet === 'LeaveRequests')?.status).toBe('ok');
  });
});
