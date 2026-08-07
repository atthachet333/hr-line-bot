'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';
import { useMounted } from '@/lib/hooks/use-mounted';
import { initializeLiffSession, LiffAuthError } from '@/lib/liff/session';
import { authenticatedFetch } from '@/lib/liff/authenticated-fetch';
import { liffErrorMessage } from '@/lib/liff/error-messages';

export default function CheckInPage() {
  const isMounted = useMounted();
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [showPopup, setShowPopup] = useState(false);
  const [displayName, setDisplayName] = useState("พนักงาน");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [clientRequestId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );

  useEffect(() => {
    // นาฬิกาเดิน
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    
    // ตั้งค่า LIFF พร้อมดึงชื่อคนใช้งาน
    const initLiff = async () => {
      const session = await initializeLiffSession('checkin');
      if (session.status === 'redirecting') return;
      if (session.status === 'error') {
        setErrorMsg(liffErrorMessage(session.code));
        return;
      }
      try {
        const profile = await liff.getProfile();
        setDisplayName(profile.displayName);
      } catch {
        /* name is cosmetic — the server re-derives identity from the token */
      }
    };
    initLiff();

    return () => clearInterval(timer);
  }, []);

  const fetchLocation = () => {
    setIsFetching(true);

    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setIsFetching(false);
        },
        (err) => {
          console.warn(err);
          alert('ดึงพิกัดไม่สำเร็จ!\nกรุณาไปที่ ตั้งค่ามือถือ > LINE > ตำแหน่งที่ตั้ง > เลือก "ในระหว่างใช้แอป"');
          setIsFetching(false);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
      );
    } else {
      alert('เบราว์เซอร์ของคุณไม่รองรับ GPS');
      setIsFetching(false);
    }
  };

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) return alert("กรุณากดดึงพิกัด GPS ก่อนครับ");
    if (isSubmitting) return; // กันกดซ้ำระหว่างส่ง

    setErrorMsg('');
    setIsSubmitting(true);

    try {
      const res = await authenticatedFetch('checkin', '/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId,
          time: currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          lat: location.lat,
          lng: location.lng,
        }),
      });

      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        setShowPopup(true); // โชว์ Popup เมื่อบันทึกจริงสำเร็จเท่านั้น
      } else if (res.status === 401) {
        setErrorMsg(liffErrorMessage('AUTHENTICATION_ERROR'));
      } else {
        setErrorMsg(result.message || result.error || 'บันทึกเวลาเข้างานไม่สำเร็จ กรุณาลองใหม่');
      }
    } catch (err) {
      if (err instanceof LiffAuthError) setErrorMsg(liffErrorMessage(err.code));
      else setErrorMsg('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeLiff = () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      setShowPopup(false);
    }
  };

  if (!isMounted) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center font-bold text-blue-600">
        กำลังโหลดระบบ...
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap');
        .font-prompt { font-family: 'Prompt', sans-serif; }
      `}</style>

      <div className="min-h-screen bg-gray-100 flex justify-center font-prompt text-black relative">
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden">
          
          <div className="bg-white pt-10 pb-6 px-6 text-center border-b border-gray-100">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-3xl mb-4 shadow-lg text-white mx-auto"> 📍 </div>
            <h1 className="text-2xl font-bold text-gray-900">แจ้งเข้างาน</h1>
            <p className="text-sm text-gray-500 mt-1">คุณ {displayName}</p>
          </div>

          <form onSubmit={handleCheckIn} className="px-8 py-8 space-y-6">
            <div className="text-center bg-gray-50 p-6 rounded-2xl border-2 border-gray-100">
              <p className="text-sm text-gray-500 mb-1">เวลาปัจจุบัน</p>
              <h2 className="text-4xl font-bold text-blue-600 tracking-wider">
                {currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </h2>
              <p className="text-sm text-gray-700 mt-2">
                {currentTime.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">ตำแหน่งของคุณ (GPS)</label>
              <div className="w-full px-4 py-4 bg-white border-2 border-gray-200 rounded-xl text-sm flex flex-col items-center justify-center gap-3">
                {location ? (
                  <span className="text-green-600 font-bold flex items-center gap-2">✅ ดึงพิกัดสำเร็จ ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})</span>
                ) : (
                  <button 
                    type="button" 
                    onClick={fetchLocation} 
                    disabled={isFetching}
                    className="bg-blue-100 text-blue-700 px-4 py-3 rounded-lg font-bold w-full flex items-center justify-center gap-2 transition-all hover:bg-blue-200 active:scale-95 cursor-pointer"
                  >
                    {isFetching ? '⏳ กำลังค้นหา...' : '📍 กดเพื่อดึงพิกัด GPS'}
                  </button>
                )}
              </div>
            </div>

            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 text-center">
                {errorMsg}
              </div>
            )}

            <div className="pt-8">
              <button
                type="submit"
                className={`w-full py-4 rounded-xl font-bold text-lg transition-colors shadow-lg flex justify-center items-center gap-2 ${location && !isSubmitting ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200 cursor-pointer' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`} 
                disabled={!location || isSubmitting}
              >
                {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันเข้างาน'}
              </button>
            </div>
          </form>

          {/* Popup Success Overlay */}
          {showPopup && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 animate-fade-in">
              <div className="bg-white w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-5xl mx-auto mb-6 text-green-500">
                  ✅
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">บันทึกสำเร็จ!</h3>
                <p className="text-gray-500 mb-8">บันทึกเวลาเข้างานเรียบร้อย ขอให้เป็นวันที่ดีครับ</p>
                <button 
                  onClick={closeLiff}
                  className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold text-lg hover:bg-blue-700"
                >
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