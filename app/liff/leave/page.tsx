'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import liff from '@line/liff';
import { useMounted } from '@/lib/hooks/use-mounted';
import { initializeLiffSession, LiffAuthError, escalateRelogin } from '@/lib/liff/session';
import { authenticatedFetch } from '@/lib/liff/authenticated-fetch';
import { liffErrorMessage } from '@/lib/liff/error-messages';
import { createSingleClose } from '@/lib/liff/close-window';

const EVIDENCE_ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

interface EmployeeProfile {
  employeeId: string;
  name: string;
  position: string;
  department: string;
}

type Phase = 'loading' | 'redirecting' | 'need_link' | 'ready' | 'error';

const FONT_STYLE = (
  <style>{`@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt { font-family: 'Prompt', sans-serif; }`}</style>
);

/** Page chrome (font + header card) shared by the loading / error / link screens. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {FONT_STYLE}
      <div className="min-h-screen bg-slate-50 flex justify-center font-prompt text-slate-800 relative">
        <div className="w-full max-w-md bg-white min-h-screen shadow-xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden pb-12">
          <div className="bg-gradient-to-r from-blue-700 to-indigo-600 pt-12 pb-8 px-6 text-center rounded-b-[2.5rem] shadow-md">
            <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-4xl mb-4 shadow-inner mx-auto border border-white/30">📝</div>
            <h1 className="text-3xl font-bold text-white tracking-wide">แบบฟอร์มลางาน</h1>
            <p className="text-sm text-blue-100 mt-2 font-light">Leave Request Application</p>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

export default function LeavePage() {
  const isMounted = useMounted();

  const [phase, setPhase] = useState<Phase>('loading');
  const [fatalError, setFatalError] = useState('');
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);

  // Optional evidence attachment.
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState('');
  const [evidenceError, setEvidenceError] = useState('');

  // Account-linking screen state.
  const [employeeIdInput, setEmployeeIdInput] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  // Leave form state.
  const [leaveType, setLeaveType] = useState('ลาป่วย');
  const [otherLeaveType, setOtherLeaveType] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [clientRequestId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );

  // Single-close guard: closeWindow() runs at most once in-client; external
  // browsers just dismiss the popup. Reused by the auto-close and the button.
  const closeOnceRef = useRef<(() => void) | null>(null);
  if (closeOnceRef.current == null) {
    closeOnceRef.current = createSingleClose({
      isInClient: () => liff.isInClient(),
      closeWindow: () => liff.closeWindow(),
      onFallback: () => setShowPopup(false),
    });
  }
  const closeOnce = () => closeOnceRef.current?.();
  const closeLiff = closeOnce;

  // Fetch the authoritative link status. Identity is never taken from cache.
  const fetchMe = useCallback(async (): Promise<void> => {
    try {
      const res = await authenticatedFetch('leave', '/api/employee/me');
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success && result.linked) {
        setEmployee(result.employee as EmployeeProfile);
        setPhase('ready');
      } else if (res.ok && result.success && !result.linked) {
        setEmployee(null);
        setPhase('need_link');
      } else if (res.status === 401) {
        // Session expired mid-use: escalate to a fresh login (guarded, no loop).
        const outcome = escalateRelogin('leave');
        if (outcome === 'redirecting') {
          setPhase('redirecting'); // "กำลังเข้าสู่ระบบ LINE ใหม่…" while liff.login navigates
        } else {
          setPhase('error');
          setFatalError(liffErrorMessage('AUTHENTICATION_ERROR'));
        }
      } else {
        setPhase('error');
        setFatalError(result.message || 'ไม่สามารถโหลดข้อมูลบัญชีได้ กรุณาลองใหม่');
      }
    } catch (err) {
      if (err instanceof LiffAuthError) {
        // Token acquisition triggered a login/redirect — show the re-login state.
        if (err.code === 'LIFF_LOGIN_REQUIRED') {
          setPhase('redirecting');
          return;
        }
        setPhase('error');
        setFatalError(liffErrorMessage(err.code));
      } else {
        setPhase('error');
        setFatalError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
      }
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Defensive: never let a stale cached profile stand in for real identity.
      try {
        ['employeeProfile', 'hr_employee', 'empProfile'].forEach((k) => {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
      } catch {
        /* storage unavailable — ignore */
      }
      const session = await initializeLiffSession('leave');
      if (session.status === 'redirecting') {
        setPhase('redirecting'); // logging in / re-logging in
        return;
      }
      if (session.status === 'error') {
        setPhase('error');
        setFatalError(liffErrorMessage(session.code));
        return;
      }
      await fetchMe();
    };
    const id = setTimeout(() => void init(), 0);
    return () => clearTimeout(id);
  }, [fetchMe]);

  const handleLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLinking) return;
    setLinkError('');
    const employeeId = employeeIdInput.trim().toUpperCase();
    if (!employeeId) {
      setLinkError('กรุณากรอกรหัสพนักงาน');
      return;
    }
    setIsLinking(true);
    try {
      const res = await authenticatedFetch('leave', '/api/employee/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        // Re-verify from the server; do not trust the just-sent employeeId.
        setPhase('loading');
        await fetchMe();
        return;
      }
      const code = result.code as string | undefined;
      if (code === 'EMPLOYEE_NOT_FOUND') {
        setLinkError('ไม่พบรหัสพนักงานนี้ในระบบ กรุณาตรวจสอบอีกครั้ง');
      } else if (code === 'EMPLOYEE_ALREADY_LINKED') {
        setLinkError('รหัสพนักงานนี้เชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อฝ่ายบุคคล');
      } else if (code === 'LINE_ACCOUNT_ALREADY_LINKED') {
        setLinkError('บัญชี LINE นี้เชื่อมกับพนักงานรายอื่นแล้ว กรุณาติดต่อฝ่ายบุคคล');
      } else if (res.status === 401) {
        setLinkError(liffErrorMessage('AUTHENTICATION_ERROR'));
      } else {
        setLinkError(result.message || 'ไม่สามารถผูกบัญชีได้ กรุณาลองใหม่');
      }
    } catch (err) {
      setLinkError(err instanceof LiffAuthError ? liffErrorMessage(err.code) : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
    } finally {
      setIsLinking(false);
    }
  };

  const onEvidenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEvidenceError('');
    const file = e.target.files?.[0] ?? null;
    if (evidencePreview) {
      URL.revokeObjectURL(evidencePreview);
      setEvidencePreview('');
    }
    if (!file) {
      setEvidenceFile(null);
      return;
    }
    if (!EVIDENCE_ALLOWED.includes(file.type)) {
      setEvidenceError('รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ PDF');
      setEvidenceFile(null);
      e.target.value = '';
      return;
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      setEvidenceError('ไฟล์มีขนาดใหญ่เกิน 10 MB');
      setEvidenceFile(null);
      e.target.value = '';
      return;
    }
    setEvidenceFile(file);
    if (file.type.startsWith('image/')) setEvidencePreview(URL.createObjectURL(file));
  };

  const removeEvidence = () => {
    if (evidencePreview) URL.revokeObjectURL(evidencePreview);
    setEvidencePreview('');
    setEvidenceFile(null);
    setEvidenceError('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg('');
    setIsSubmitting(true);

    const raw = new FormData(e.currentTarget);
    const finalLeaveType = leaveType === 'ลาอื่นๆ' ? `ลาอื่นๆ (${otherLeaveType})` : leaveType;

    try {
      // multipart/form-data so an optional evidence file can ride along. The
      // access token is attached as Bearer by authenticatedFetch (no base64/blob
      // is ever persisted client-side).
      const fd = new FormData();
      fd.append('clientRequestId', clientRequestId);
      fd.append('leaveType', finalLeaveType);
      fd.append('startDate', String(raw.get('startDate') ?? ''));
      fd.append('endDate', String(raw.get('endDate') ?? ''));
      fd.append('reason', String(raw.get('reason') ?? ''));
      if (evidenceFile) fd.append('evidence', evidenceFile, evidenceFile.name);

      const res = await authenticatedFetch('leave', '/api/leave', { method: 'POST', body: fd });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        // Evidence (if any) was part of this multipart request, so it is fully
        // uploaded by the time we get success. Show the success state briefly,
        // then auto-close the LIFF window (once) when inside the LINE client.
        setShowPopup(true);
        if (liff.isInClient()) window.setTimeout(() => closeOnce(), 1200);
      } else if (result.code === 'EMPLOYEE_NOT_LINKED') {
        setPhase('need_link');
      } else if (res.status === 401) {
        const outcome = escalateRelogin('leave');
        if (outcome === 'redirecting') setPhase('redirecting');
        else setErrorMsg(liffErrorMessage('AUTHENTICATION_ERROR'));
      } else {
        setErrorMsg(result.message || result.error || 'ไม่สามารถส่งคำขอได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err) {
      if (err instanceof LiffAuthError && err.code === 'LIFF_LOGIN_REQUIRED') setPhase('redirecting');
      else setErrorMsg(err instanceof LiffAuthError ? liffErrorMessage(err.code) : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isMounted) return null;

  if (phase === 'loading' || phase === 'redirecting') {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-sm text-indigo-600 font-semibold">
            {phase === 'redirecting' ? 'กำลังเข้าสู่ระบบ LINE ใหม่…' : 'กำลังตรวจสอบบัญชี...'}
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell>
        <div className="px-6 py-16 text-center">
          <div className="text-5xl mb-4 opacity-70">⚠️</div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">เกิดข้อผิดพลาด</h3>
          <p className="text-sm text-slate-500">{fatalError}</p>
        </div>
      </Shell>
    );
  }

  if (phase === 'need_link') {
    return (
      <Shell>
        <form onSubmit={handleLink} className="px-6 py-8 space-y-6">
          <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-5 text-center">
            <div className="text-4xl mb-2">🔗</div>
            <h2 className="font-bold text-indigo-700 mb-1">เชื่อมบัญชีพนักงาน</h2>
            <p className="text-sm text-slate-600">
              บัญชี LINE นี้ยังไม่ได้เชื่อมกับข้อมูลพนักงาน กรุณากรอกรหัสพนักงานเพื่อเชื่อมบัญชีครั้งแรก
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">รหัสพนักงาน <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={employeeIdInput}
              onChange={(e) => setEmployeeIdInput(e.target.value)}
              required
              autoCapitalize="characters"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-base tracking-wider"
              placeholder="เช่น S2A007"
            />
          </div>

          {linkError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{linkError}</div>
          )}

          <button
            type="submit"
            disabled={isLinking}
            className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-[0_8px_30px_rgb(79,70,229,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
          >
            {isLinking ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                กำลังเชื่อมบัญชี...
              </>
            ) : 'เชื่อมบัญชี'}
          </button>
        </form>
      </Shell>
    );
  }

  // phase === 'ready'
  return (
    <>
      {FONT_STYLE}
      <div className="min-h-screen bg-slate-50 flex justify-center font-prompt text-slate-800 relative">
        <div className="w-full max-w-md bg-white min-h-screen shadow-xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden pb-12">

          <div className="bg-gradient-to-r from-blue-700 to-indigo-600 pt-12 pb-8 px-6 text-center rounded-b-[2.5rem] shadow-md">
            <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-4xl mb-4 shadow-inner mx-auto border border-white/30">📝</div>
            <h1 className="text-3xl font-bold text-white tracking-wide">แบบฟอร์มลางาน</h1>
            <p className="text-sm text-blue-100 mt-2 font-light">Leave Request Application</p>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-8 space-y-8">

            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span> ข้อมูลพนักงาน
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">รหัสพนักงาน</p>
                  <p className="text-sm font-semibold text-slate-800">{employee?.employeeId || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">ชื่อ-นามสกุล</p>
                  <p className="text-sm font-semibold text-slate-800">{employee?.name || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">ตำแหน่ง</p>
                  <p className="text-sm font-semibold text-slate-800">{employee?.position || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">แผนก</p>
                  <p className="text-sm font-semibold text-slate-800">{employee?.department || '-'}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span> รายละเอียดการลา
              </h3>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">ประเภทการลา <span className="text-red-500">*</span></label>
                <div className="relative">
                  <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all appearance-none font-medium text-slate-700">
                    <option value="ลาป่วย">🤒 ลาป่วย</option>
                    <option value="ลากิจ">💼 ลากิจ</option>
                    <option value="ลาพักร้อน">🌴 ลาพักร้อน</option>
                    <option value="ลาอื่นๆ">✨ อื่นๆ (โปรดระบุ)</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">▼</div>
                </div>
              </div>
              {leaveType === 'ลาอื่นๆ' && (
                <div className="animate-fade-in pt-1">
                  <label className="block text-xs font-semibold text-indigo-600 mb-1.5">ระบุประเภทการลา <span className="text-red-500">*</span></label>
                  <input type="text" required value={otherLeaveType} onChange={(e) => setOtherLeaveType(e.target.value)} className="w-full px-4 py-3 bg-indigo-50/50 border border-indigo-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all text-sm text-indigo-900 placeholder-indigo-300" placeholder="เช่น ลาคลอด, ลาบวช..." />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">ตั้งแต่วันที่ <span className="text-red-500">*</span></label>
                  <input type="date" name="startDate" required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm text-slate-600" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">ถึงวันที่ <span className="text-red-500">*</span></label>
                  <input type="date" name="endDate" required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm text-slate-600" />
                </div>
              </div>
              <div className="pt-2">
                <label className="block text-sm font-semibold text-slate-700 mb-2">เหตุผลการลา <span className="text-red-500">*</span></label>
                <textarea name="reason" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm text-slate-700 h-24 resize-none" placeholder="โปรดระบุเหตุผลอย่างละเอียด..."></textarea>
              </div>

              {/* Optional evidence attachment — never required */}
              <div className="pt-2">
                <label className="block text-sm font-semibold text-slate-700 mb-1">แนบหลักฐานการลา (ไม่บังคับ)</label>
                <p className="text-xs text-slate-400 mb-2">รองรับ JPG, PNG, WEBP หรือ PDF ขนาดไม่เกิน 10 MB</p>
                {!evidenceFile ? (
                  <label className="flex flex-col items-center justify-center gap-2 w-full px-4 py-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer text-slate-500 hover:border-indigo-300 transition-colors">
                    <span className="text-2xl">📎</span>
                    <span className="text-xs font-medium">เลือกรูปภาพหรือไฟล์ PDF</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onEvidenceChange} />
                  </label>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-3">
                      {evidencePreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={evidencePreview} alt="ตัวอย่างหลักฐาน" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-red-50 flex items-center justify-center text-2xl">📄</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{evidenceFile.name}</p>
                        <p className="text-xs text-slate-400">{formatBytes(evidenceFile.size)}</p>
                      </div>
                      <button type="button" onClick={removeEvidence} className="text-red-500 text-sm font-semibold px-2 py-1 hover:bg-red-50 rounded-lg">ลบ</button>
                    </div>
                    <label className="block mt-2 text-center text-xs text-indigo-600 font-medium cursor-pointer">
                      เปลี่ยนไฟล์
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onEvidenceChange} />
                    </label>
                  </div>
                )}
                {evidenceError && <p className="mt-2 text-xs text-red-600">{evidenceError}</p>}
              </div>
            </div>

            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {errorMsg}
              </div>
            )}

            <div className="pt-6">
              <button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-[0_8px_30px_rgb(79,70,229,0.3)] hover:shadow-[0_8px_30px_rgb(79,70,229,0.5)] hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none flex justify-center items-center gap-2">
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    กำลังประมวลผล...
                  </>
                ) : 'ส่งคำขอลางาน'}
              </button>
            </div>
          </form>

          {showPopup && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-5 animate-fade-in">
              <div className="bg-white w-full max-w-[320px] rounded-[2rem] p-8 text-center shadow-2xl transform transition-all scale-100">
                <div className="w-24 h-24 bg-gradient-to-tr from-green-400 to-emerald-500 rounded-full flex items-center justify-center text-5xl mx-auto mb-6 shadow-lg shadow-green-500/30">
                  <span className="text-white drop-shadow-md">✓</span>
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-2">ส่งคำขอสำเร็จ</h3>
                <p className="text-slate-500 mb-8 text-sm leading-relaxed">ข้อมูลการลางานของคุณถูกส่งเข้าระบบ HR เรียบร้อยแล้ว</p>
                <button onClick={closeLiff} className="w-full bg-slate-100 text-slate-700 py-3.5 rounded-xl font-bold text-base hover:bg-slate-200 transition-colors">
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
