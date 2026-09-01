'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMounted } from '@/lib/hooks/use-mounted';
import { initializeLiffSession, LiffAuthError, escalateRelogin } from '@/lib/liff/session';
import { authenticatedFetch } from '@/lib/liff/authenticated-fetch';
import { sanitizeHistoryOwner, attendanceHistoryLoginReturnUrl } from '@/lib/liff/config';
import { formatMinutesThai, formatWorkHours, summaryLabels } from '@/lib/attendance/attendance-format';
import { WorkSummarySection } from './WorkSummarySection';

/** '' = ok. Otherwise a specific, non-misleading failure state. */
type HistoryError = '' | 'AUTH' | 'NOT_LINKED' | 'LOAD';

interface HistoryItem {
  date: string; checkin: string; checkout: string; workHours: number | null;
  employmentType: string; status: 'complete' | 'open'; summary?: string; summaries?: string[];
  sessions?: Array<{
    checkin: string; checkout: string; workHours: number | null; summary: string;
    status: 'complete' | 'open' | 'orphan-checkout';
  }>;
}
interface Summary { workDays: number; totalMinutes: number; }

const THAI_MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('th-TH', { month: 'long' }).format(new Date(2026, i, 1)),
);

/** "ศุกร์ 8 สิงหาคม 2569" — Buddhist year, anchored at UTC so the date never drifts. */
function formatFullDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }).format(d);
  const rest = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  return `${weekday} ${rest}`;
}

export default function AttendanceHistoryPage() {
  const mounted = useMounted();
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ workDays: 0, totalMinutes: 0 });
  const [employmentType, setEmploymentType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<HistoryError>('');

  // History reuses the checkin/checkout LIFF context it was opened from (?from=).
  // The value only selects which existing LIFF config/endpoint to authenticate
  // against — authorization is always enforced server-side from the token.
  const owner = useMemo(
    () => sanitizeHistoryOwner(
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') : null,
    ),
    [],
  );

  const labels = summaryLabels(employmentType);

  const loginRedirectUri = useMemo(
    () => typeof window !== 'undefined'
      ? attendanceHistoryLoginReturnUrl(owner, window.location.origin)
      : undefined,
    [owner],
  );

  const load = useCallback(async (selectedMonth: number, selectedYear: number) => {
    setLoading(true); setError('');
    try {
      const response = await authenticatedFetch(owner, `/api/attendance/history?month=${selectedMonth}&year=${selectedYear}`);
      const result = await response.json().catch(() => ({}));
      // A 401 is a real LINE session/token problem → offer re-login recovery.
      if (response.status === 401) { setError('AUTH'); return; }
      // A linked-account problem is distinct from a token expiry.
      if (result?.code === 'EMPLOYEE_NOT_LINKED') { setError('NOT_LINKED'); return; }
      if (!response.ok || !result.success) { setError('LOAD'); return; }
      // Only NOW do we treat numbers as real data.
      setItems(result.data.items as HistoryItem[]);
      setSummary((result.data.summary as Summary) ?? { workDays: 0, totalMinutes: 0 });
      setEmploymentType(String(result.data.employmentType ?? ''));
    } catch (err) {
      setError(err instanceof LiffAuthError ? 'AUTH' : 'LOAD');
    } finally { setLoading(false); }
  }, [owner]);

  useEffect(() => {
    const run = async () => {
      // Log in against the owner's LIFF id but return to an IN-SCOPE owner path
      // (the owner page forwards back here) so LINE never 400s.
      const session = await initializeLiffSession(owner, { loginRedirectUri });
      if (session.status === 'ready') await load(month, year);
      else if (session.status === 'error') { setError('AUTH'); setLoading(false); }
    };
    void run();
  }, [load, loginRedirectUri, month, year, owner]);

  const retry = useCallback(() => {
    if (error === 'AUTH') {
      // Persistent 401 means LINE rejected the token. Force one fresh login,
      // returning through the owner's in-scope endpoint to avoid LINE 400.
      const outcome = escalateRelogin(owner, { loginRedirectUri });
      if (outcome === 'redirecting') {
        setLoading(true);
        setError('');
      }
      return;
    }
    void load(month, year);
  }, [error, load, loginRedirectUri, month, owner, year]);

  const years = Array.from({ length: 5 }, (_, index) => now.getFullYear() - index);

  if (!mounted) {
    return <main className="min-h-screen grid place-items-center bg-slate-50 font-prompt text-slate-500">กำลังโหลด...</main>;
  }

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt{font-family:'Prompt',sans-serif;}`}</style>
      <main className="min-h-screen bg-slate-50 font-prompt text-slate-900">
        <div className="mx-auto w-full max-w-md px-4 pb-12">

          {/* Header */}
          <header className="rounded-b-3xl bg-blue-700 px-6 pb-7 pt-9 text-white shadow-md">
            <h1 className="text-2xl font-bold leading-tight">ประวัติการเข้างาน–ออกงาน</h1>
            <p className="mt-1 text-sm text-blue-100">ตรวจสอบเวลาทำงานของคุณ</p>
            <p className="mt-3 text-[11px] font-medium text-blue-200">ข้อมูลอัปเดตจากระบบล่าสุด</p>
          </header>

          {/* Summary card */}
          <section className="-mt-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">สรุปเดือน{THAI_MONTHS[month - 1]} {year + 543}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${labels.hasType ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                {labels.typeText}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-blue-50/70 p-4 text-center">
                <div className="text-3xl font-bold tabular-nums text-blue-700">{summary.workDays}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">{labels.workDaysLabel}</div>
              </div>
              <div className="rounded-2xl bg-blue-50/70 p-4 text-center">
                <div className="text-2xl font-bold tabular-nums leading-9 text-blue-700">{formatMinutesThai(summary.totalMinutes)}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">{labels.totalLabel}</div>
              </div>
            </div>
          </section>

          {/* Filter */}
          <section className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <label className="text-xs font-semibold text-slate-600">เดือน
              <select
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-base font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={loading}
              >
                {THAI_MONTHS.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">ปี
              <select
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-base font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={loading}
              >
                {years.map((value) => <option key={value} value={value}>{value + 543}</option>)}
              </select>
            </label>
          </section>

          {/* Content */}
          <div className="mt-4 space-y-3">
            {loading && [0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <div className="mb-4 h-4 w-40 rounded bg-slate-200" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-10 rounded bg-slate-100" />
                  <div className="h-10 rounded bg-slate-100" />
                </div>
                <div className="mt-4 h-8 w-32 rounded bg-slate-100" />
              </div>
            ))}

            {!loading && error && (
              <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-100">
                <p className="text-base font-semibold text-slate-800">
                  {error === 'AUTH' ? 'กรุณาเปิดหน้านี้จากแอป LINE อีกครั้ง' : 'ไม่สามารถโหลดประวัติได้'}
                </p>
                {error !== 'AUTH' && <p className="mt-1 text-sm text-slate-500">กรุณาลองใหม่อีกครั้ง</p>}
                <button
                  type="button" onClick={retry}
                  className="mt-5 inline-flex items-center justify-center rounded-xl bg-blue-700 px-6 py-3 text-sm font-bold text-white hover:bg-blue-800"
                >
                  ลองใหม่
                </button>
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-100">
                <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-2xl text-blue-500">📅</div>
                <p className="text-base font-semibold text-slate-700">ยังไม่มีประวัติการเข้างานในเดือนนี้</p>
                <p className="mt-1 text-sm text-slate-400">ลองเลือกเดือนหรือปีอื่น</p>
              </div>
            )}

            {!loading && !error && items.map((item) => {
              const open = item.status === 'open';
              // New APIs return every checkout summary. The singular fallback
              // keeps the UI compatible with an intermediate/older response.
              const workSummaries = Array.isArray(item.summaries)
                ? item.summaries.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
                : (typeof item.summary === 'string' && item.summary.trim() ? [item.summary] : []);
              const sessions = Array.isArray(item.sessions) ? item.sessions : [];
              const multipleSessions = sessions.length > 1;
              return (
                <article key={item.date} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <h3 className="text-base font-bold text-slate-900">{formatFullDate(item.date)}</h3>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${open ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                      {open ? 'กำลังทำงาน' : 'ครบแล้ว'}
                    </span>
                  </div>

                  {multipleSessions ? (
                    <div className="space-y-3">
                      {sessions.map((session, index) => (
                        <section key={`${item.date}-session-${index}`} className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
                          <h4 className="mb-3 text-sm font-bold text-blue-800">รอบที่ {index + 1}</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="text-xs text-slate-500">เข้า</div>
                              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">{session.checkin || '-'}</div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-500">ออก</div>
                              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">{session.checkout || 'ยังไม่ได้ออกงาน'}</div>
                            </div>
                          </div>
                          <div className="mt-3 text-sm font-semibold text-blue-700">{formatWorkHours(session.workHours)}</div>
                          <div className="mt-3 border-t border-blue-100 pt-3">
                            <div className="text-xs font-semibold text-slate-500">สรุปงาน</div>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
                              {session.summary || (session.status === 'complete' ? 'ไม่มีข้อมูลสรุปงาน' : 'ยังไม่ได้ออกงาน')}
                            </p>
                          </div>
                        </section>
                      ))}
                      <div className="flex items-center justify-between rounded-xl bg-blue-700 px-4 py-3 text-white">
                        <span className="text-sm font-semibold">รวมวันนี้</span>
                        <span className="text-lg font-bold">{formatWorkHours(item.workHours)}</span>
                      </div>
                      <div className="text-right">
                        <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          {item.employmentType || 'ยังไม่ระบุ'}
                        </span>
                      </div>
                    </div>
                  ) : (<>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">เข้างาน</div>
                      <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">{item.checkin || '-'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">ออกงาน</div>
                      <div className={`mt-0.5 text-lg font-bold tabular-nums ${open ? 'text-amber-600' : 'text-slate-800'}`}>
                        {item.checkout || 'ยังไม่ได้ออกงาน'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-slate-500">เวลาทำงาน</div>
                      <div className="mt-0.5 text-xl font-bold text-blue-700">{formatWorkHours(item.workHours)}</div>
                    </div>
                    <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                      {item.employmentType || 'ยังไม่ระบุ'}
                    </span>
                  </div>

                  {!open && (
                    <WorkSummarySection date={item.date} summaries={workSummaries} />
                  )}
                  </>)}
                </article>
              );
            })}
          </div>
        </div>
      </main>
    </>
  );
}
