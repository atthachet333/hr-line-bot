'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';
import { useMounted } from '@/lib/hooks/use-mounted';

export default function LeavePage() {
  const isMounted = useMounted();
  const [leaveType, setLeaveType] = useState('ลาป่วย');
  const [otherLeaveType, setOtherLeaveType] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [empId, setEmpId] = useState('');
  const [empName, setEmpName] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  // Idempotency key generated once per form mount so retries don't duplicate.
  const [clientRequestId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );

  useEffect(() => {
    const initLiff = async () => {
      try {
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID || '' });
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();

          // Prefill for display only — the server re-derives identity from the token.
          const res = await fetch('/api/balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: profile.userId })
          });

          if (res.ok) {
            const result = await res.json();
            if (result.status === 'success' && result.data) {
              if (result.data.name && result.data.name !== "รอระบุชื่อ") setEmpName(result.data.name);
              if (result.data.empId) setEmpId(result.data.empId);
              if (result.data.position) setPosition(result.data.position);
              if (result.data.department) setDepartment(result.data.department);
            }
          }
        } else if (!liff.isInClient()) {
          liff.login();
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      } finally {
        setIsLoadingProfile(false);
      }
    };
    initLiff();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg('');
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const finalLeaveType = leaveType === 'ลาอื่นๆ' ? `ลาอื่นๆ (${otherLeaveType})` : leaveType;

    try {
      // Send only the request details plus the LINE token. Identity (userId,
      // employee id, name) is verified and resolved on the server.
      const idToken = liff.getIDToken();
      const accessToken = liff.getAccessToken();
      if (!idToken && !accessToken) {
        setErrorMsg('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดหน้านี้จากแอป LINE');
        setIsSubmitting(false);
        return;
      }

      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          accessToken,
          clientRequestId,
          leaveType: finalLeaveType,
          startDate: formData.get('startDate'),
          endDate: formData.get('endDate'),
          reason: formData.get('reason'),
        })
      });

      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        setShowPopup(true);
      } else {
        setErrorMsg(result.message || result.error || 'ไม่สามารถส่งคำขอได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch {
      setErrorMsg('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeLiff = () => liff.isInClient() ? liff.closeWindow() : setShowPopup(false);

  if (!isMounted) return null;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt { font-family: 'Prompt', sans-serif; }`}</style>
      <div className="min-h-screen bg-slate-50 flex justify-center font-prompt text-slate-800 relative">
        <div className="w-full max-w-md bg-white min-h-screen shadow-xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden pb-12">
          
          <div className="bg-gradient-to-r from-blue-700 to-indigo-600 pt-12 pb-8 px-6 text-center rounded-b-[2.5rem] shadow-md">
            <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-4xl mb-4 shadow-inner mx-auto border border-white/30">📝</div>
            <h1 className="text-3xl font-bold text-white tracking-wide">แบบฟอร์มลางาน</h1>
            <p className="text-sm text-blue-100 mt-2 font-light">Leave Request Application</p>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-8 space-y-8">
            
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4 relative">
              {isLoadingProfile && (
                 <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-2xl">
                    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <p className="text-xs text-indigo-600 mt-2 font-semibold">กำลังดึงข้อมูล...</p>
                 </div>
              )}
              <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span> ข้อมูลพนักงาน
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">รหัสพนักงาน <span className="text-red-500">*</span></label>
                  <input type="text" value={empId} onChange={(e) => setEmpId(e.target.value)} required className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm" placeholder="EMP001" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
                  <input type="text" value={empName} onChange={(e) => setEmpName(e.target.value)} required className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm" placeholder="ระบุชื่อจริง" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">ตำแหน่ง <span className="text-red-500">*</span></label>
                  <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} required className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm" placeholder="ตำแหน่งงาน" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">แผนก <span className="text-red-500">*</span></label>
                  <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} required className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm" placeholder="ฝ่าย/แผนก" />
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