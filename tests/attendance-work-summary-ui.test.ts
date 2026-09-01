import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkSummarySection } from '@/app/liff/attendance/history/WorkSummarySection';
import { canSubmitCheckout } from '@/lib/validation/attendance';

describe('attendance work-summary UI', () => {
  it('renders Sheet summary as escaped plain text, never executable HTML', () => {
    const html = renderToStaticMarkup(createElement(WorkSummarySection, {
      date: '2026-08-31', summaries: ['<script>alert("xss")</script>'],
    }));
    expect(html).toContain('&lt;script&gt;alert');
    expect(html).not.toContain('<script>');
  });

  it('renders the legacy fallback when a checkout has no summary', () => {
    const html = renderToStaticMarkup(createElement(WorkSummarySection, {
      date: '2026-08-31', summaries: [],
    }));
    expect(html).toContain('ไม่มีข้อมูลสรุปงาน');
  });

  it('keeps textarea state on failures and includes required mobile-friendly controls', () => {
    const pagePath = fileURLToPath(new URL('../app/liff/checkout/page.tsx', import.meta.url));
    const source = readFileSync(pagePath, 'utf8');
    expect(source).toContain('required');
    expect(source).toContain('maxLength={WORK_SUMMARY_MAX_LENGTH}');
    expect(source).toContain('{summary.length} / {WORK_SUMMARY_MAX_LENGTH}');
    expect(source).not.toContain("setSummary('')");
    const historyPath = fileURLToPath(new URL('../app/liff/attendance/history/page.tsx', import.meta.url));
    const historySource = readFileSync(historyPath, 'utf8');
    expect(historySource).toContain('รอบที่ {index + 1}');
    expect(historySource).toContain('รวมวันนี้');
  });

  it('hard-disables submit until GPS and a valid summary are both ready', () => {
    expect(canSubmitCheckout({ hasLocation: false, summary: '1234567890', isSubmitting: false })).toBe(false);
    expect(canSubmitCheckout({ hasLocation: true, summary: '', isSubmitting: false })).toBe(false);
    expect(canSubmitCheckout({ hasLocation: true, summary: '123456789', isSubmitting: false })).toBe(false);
    expect(canSubmitCheckout({ hasLocation: true, summary: '1234567890', isSubmitting: true })).toBe(false);
    expect(canSubmitCheckout({ hasLocation: true, summary: '1234567890', isSubmitting: false })).toBe(true);
  });
});
