'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import liff from '@line/liff';

interface HistoryItem {
  requestId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  approvedBy: string;
  approvedAt: string;
  rejectedBy: string;
  rejectedAt: string;
  rejectedReason: string;
}

const STATUS_META: Record<HistoryItem['status'], { label: string; className: string }> = {
  PENDING: { label: 'รออนุมัติ', className: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ไม่อนุมัติ', className: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'ยกเลิก', className: 'bg-gray-200 text-gray-600' },
};

/**
 * Format a YYYY-MM-DD date in Thai (Bangkok), off-by-one safe. Only accepts a
 * real YMD (the server normalises history dates to this) — anything else renders
 * "-" so a stray serial number never shows a garbage year like 46787.
 */
function fmtDate(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '-';
  const d = new Date(`${ymd}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric' });
}

/** Format an ISO timestamp in Thai date + time (Bangkok). */
function fmtDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) +
    ' น.'
  );
}

interface BalanceRow {
  type: string;
  icon: string;
  entitlement: number;
  used: number;
  remaining: number;
}

const CATEGORY_META: Array<{ key: 'sick' | 'business' | 'annual'; type: string; icon: string }> = [
  { key: 'sick', type: 'ลาป่วย', icon: '🤒' },
  { key: 'business', type: 'ลากิจ', icon: '💼' },
  { key: 'annual', type: 'ลาพักร้อน', icon: '🌴' },
];

export default function LeaveBalancePage() {
  const [activeTab, setActiveTab] = useState<'balance' | 'history'>('balance');

  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [ready, setReady] = useState(false);

  const accessTokenRef = useRef<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const loadBalance = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token) {
      setBalanceError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดหน้านี้จากแอป LINE');
      return;
    }
    setBalanceLoading(true);
    setBalanceError('');
    try {
      const res = await fetch('/api/balance/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success && result.balances) {
        setBalances(
          CATEGORY_META.map((m) => ({
            type: m.type,
            icon: m.icon,
            entitlement: result.balances[m.key]?.entitlement ?? 0,
            used: result.balances[m.key]?.used ?? 0,
            remaining: result.balances[m.key]?.remaining ?? 0,
          })),
        );
      } else if (res.status === 401) {
        setBalanceError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดหน้านี้จากแอป LINE อีกครั้ง');
      } else if (result.code === 'EMPLOYEE_NOT_LINKED') {
        setBalanceError('ยังไม่พบการผูกบัญชีพนักงานของคุณ กรุณาติดต่อฝ่ายบุคคล');
      } else if (result.code === 'BALANCE_NOT_CONFIGURED') {
        setBalanceError('ยังไม่ได้ตั้งค่าสิทธิ์วันลาของคุณ กรุณาติดต่อฝ่ายบุคคล');
      } else {
        setBalanceError(result.message || 'ไม่สามารถโหลดยอดวันลาได้ กรุณาลองใหม่');
      }
    } catch {
      setBalanceError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token) {
      setHistoryError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดหน้านี้จากแอป LINE');
      return;
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await fetch('/api/leave/history', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        setHistory(Array.isArray(result.items) ? result.items : []);
        setHistoryLoaded(true);
      } else if (res.status === 401) {
        setHistoryError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดหน้านี้จากแอป LINE อีกครั้ง');
      } else if (result.code === 'EMPLOYEE_NOT_LINKED') {
        setHistoryError('ยังไม่พบการผูกบัญชีพนักงานของคุณ กรุณาติดต่อฝ่ายบุคคล');
      } else {
        setHistoryError(result.message || 'ไม่สามารถโหลดประวัติการลาได้ กรุณาลองใหม่');
      }
    } catch {
      setHistoryError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID_BALANCE as string });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        accessTokenRef.current = liff.getAccessToken();
        setReady(true);
        await loadBalance();
      } catch {
        setBalanceError('ไม่สามารถเริ่มต้น LINE ได้ กรุณาเปิดหน้านี้จากแอป LINE');
      }
    };
    init();
  }, [loadBalance]);

  // Refresh on every tab open so the latest state shows after an approval
  // (no stale cache; nothing is persisted in localStorage).
  const openBalance = () => {
    setActiveTab('balance');
    if (ready) void loadBalance();
  };
  const openHistory = () => {
    setActiveTab('history');
    void loadHistory();
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt { font-family: 'Prompt', sans-serif; }` }} />
      <div className="min-h-screen bg-gray-100 flex justify-center font-prompt text-black">
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden relative">

          <div className="bg-blue-600 pt-10 pb-6 px-6 text-center text-white">
            <h1 className="text-2xl font-bold tracking-wide mb-6">ข้อมูลวันลาของคุณ</h1>
            <div className="flex bg-blue-700 p-1 rounded-xl">
              <button onClick={openBalance} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'balance' ? 'bg-white text-blue-600 shadow' : 'text-blue-100'}`}>
                สิทธิ์คงเหลือ
              </button>
              <button onClick={openHistory} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'history' ? 'bg-white text-blue-600 shadow' : 'text-blue-100'}`}>
                ประวัติการลา
              </button>
            </div>
          </div>

          <div className="p-6 h-full bg-gray-50">
            {
              <>
                {activeTab === 'balance' && (
                  balanceLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
                      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                      <div className="text-gray-500 font-medium">กำลังโหลดข้อมูล...</div>
                    </div>
                  ) : balanceError ? (
                    <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm mt-4">
                      <div className="text-4xl mb-3 opacity-70">⚠️</div>
                      <h3 className="text-gray-900 font-bold mb-1">ไม่สามารถแสดงยอดวันลาได้</h3>
                      <p className="text-sm text-gray-500 mb-5 px-6">{balanceError}</p>
                      <button onClick={() => void loadBalance()} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors">
                        ลองใหม่
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4 animate-fade-in">
                      {balances.map((item, index) => (
                        <div key={index} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-blue-50 shadow-inner">{item.icon}</div>
                            <div>
                              <h3 className="font-bold text-gray-900">{item.type}</h3>
                              <p className="text-xs text-gray-500">ใช้ไปแล้ว {item.used} / {item.entitlement} วัน</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-bold text-blue-600">{item.remaining}</span>
                            <span className="text-xs text-gray-400 block mt-0.5">คงเหลือ</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {activeTab === 'history' && (
                  <div className="space-y-3 animate-fade-in">
                    {historyLoading ? (
                      <div className="flex flex-col items-center justify-center py-16">
                        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                        <div className="text-gray-500 font-medium">กำลังโหลดประวัติ...</div>
                      </div>
                    ) : historyError ? (
                      <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm mt-4">
                        <div className="text-4xl mb-3 opacity-70">⚠️</div>
                        <h3 className="text-gray-900 font-bold mb-1">เกิดข้อผิดพลาด</h3>
                        <p className="text-sm text-gray-500 mb-5 px-6">{historyError}</p>
                        <button onClick={() => void loadHistory()} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors">
                          ลองใหม่
                        </button>
                      </div>
                    ) : historyLoaded && history.length === 0 ? (
                      <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm mt-4">
                        <div className="text-5xl mb-4 opacity-70">📭</div>
                        <h3 className="text-gray-900 font-bold mb-1">ยังไม่มีประวัติการลางาน</h3>
                      </div>
                    ) : (
                      history.map((item) => {
                        const meta = STATUS_META[item.status] ?? STATUS_META.PENDING;
                        return (
                          <div key={item.requestId} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <div className="flex justify-between items-start gap-3">
                              <div>
                                <h4 className="font-bold text-gray-900 text-sm">{item.leaveType}</h4>
                                <p className="text-[11px] text-gray-400 mt-0.5">{item.requestId}</p>
                              </div>
                              <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${meta.className}`}>
                                {meta.label}
                              </span>
                            </div>

                            <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                              <div className="flex justify-between"><span className="text-gray-400">วันที่เริ่ม</span><span className="font-medium text-gray-800">{fmtDate(item.startDate)}</span></div>
                              <div className="flex justify-between"><span className="text-gray-400">วันที่สิ้นสุด</span><span className="font-medium text-gray-800">{fmtDate(item.endDate)}</span></div>
                              <div className="flex justify-between"><span className="text-gray-400">จำนวนวัน</span><span className="font-medium text-gray-800">{item.totalDays} วัน</span></div>
                              <div className="flex justify-between gap-4"><span className="text-gray-400 shrink-0">เหตุผล</span><span className="font-medium text-gray-800 text-right break-words">{item.reason || '-'}</span></div>
                              <div className="flex justify-between"><span className="text-gray-400">วันที่ยื่น</span><span className="font-medium text-gray-800">{fmtDateTime(item.createdAt)}</span></div>

                              {item.status === 'APPROVED' && (
                                <>
                                  <div className="flex justify-between border-t border-gray-50 pt-1.5 mt-1.5"><span className="text-gray-400">ผู้อนุมัติ</span><span className="font-medium text-green-700">{item.approvedBy || '-'}</span></div>
                                  <div className="flex justify-between"><span className="text-gray-400">วันที่อนุมัติ</span><span className="font-medium text-gray-800">{fmtDateTime(item.approvedAt)}</span></div>
                                </>
                              )}
                              {item.status === 'REJECTED' && (
                                <>
                                  <div className="flex justify-between border-t border-gray-50 pt-1.5 mt-1.5"><span className="text-gray-400">ผู้ปฏิเสธ</span><span className="font-medium text-red-700">{item.rejectedBy || '-'}</span></div>
                                  <div className="flex justify-between gap-4"><span className="text-gray-400 shrink-0">เหตุผลไม่อนุมัติ</span><span className="font-medium text-gray-800 text-right break-words">{item.rejectedReason || '-'}</span></div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            }
          </div>
        </div>
      </div>
    </>
  );
}
