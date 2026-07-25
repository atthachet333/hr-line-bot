'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';
import { useMounted } from '@/lib/hooks/use-mounted';

export default function CheckOutPage() {
  const isMounted = useMounted();
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [timeText, setTimeText] = useState("--:--:--");
  const [dateText, setDateText] = useState("กำลังดึงเวลา...");
  
  const [summary, setSummary] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [displayName, setDisplayName] = useState("พนักงาน");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [clientRequestId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeText(now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDateText(now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }));
    };
    tick(); 
    const timer = setInterval(tick, 1000); 

    const initLiff = async () => {
      try {
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID_CHECKOUT || '' });
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          setDisplayName(profile.displayName);
        } else { liff.login(); }
      } catch (err) { console.error(err); }
    };
    initLiff();

    return () => clearInterval(timer);
  }, []);

  const fetchLocation = () => {
    setIsFetching(true);
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setIsFetching(false); },
        () => { alert("กรุณาอนุญาต GPS"); setIsFetching(false); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
      );
    }
  };

  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) return alert("กรุณากดดึงพิกัด GPS ก่อนครับ");
    if (!summary.trim()) return alert("กรุณาระบุสรุปงานประจำวันด้วยครับ");
    if (isSubmitting) return; // กันกดซ้ำระหว่างส่ง

    setErrorMsg('');
    setIsSubmitting(true);

    try {
      const idToken = liff.getIDToken();
      const accessToken = liff.getAccessToken();
      if (!idToken && !accessToken) {
        setErrorMsg('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดหน้านี้จากแอป LINE');
        setIsSubmitting(false);
        return;
      }

      const res = await fetch('/api/attendance/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          accessToken,
          clientRequestId,
          time: timeText,
          lat: location.lat,
          lng: location.lng,
          summary,
        })
      });

      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        setShowPopup(true); // โชว์ Popup เมื่อบันทึกจริงสำเร็จเท่านั้น
      } else {
        setErrorMsg(result.message || result.error || 'บันทึกเวลาออกงานไม่สำเร็จ กรุณาลองใหม่');
      }
    } catch {
      setErrorMsg('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeLiff = () => liff.isInClient() ? liff.closeWindow() : setShowPopup(false);

  if (!isMounted) return <div className="min-h-screen bg-gray-100 flex items-center justify-center font-bold text-gray-900">กำลังโหลดระบบ...</div>;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt { font-family: 'Prompt', sans-serif; }`}</style>
      <div className="min-h-screen bg-gray-100 flex justify-center font-prompt text-black relative">
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden pb-10">
          
          <div className="bg-white pt-10 pb-6 px-6 text-center border-b border-gray-100">
            <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center text-3xl mb-4 shadow-lg text-white mx-auto"> 🏃 </div>
            <h1 className="text-2xl font-bold text-gray-900">แจ้งออกงาน</h1>
            <p className="text-sm text-gray-500 mt-1">คุณ {displayName}</p>
          </div>

          <form onSubmit={handleCheckOut} className="px-8 py-6 space-y-6">
            <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div><span className="text-gray-600 font-medium block text-sm">เวลาออกงาน</span><span className="text-xs text-gray-400">{dateText}</span></div>
              <span className="text-3xl font-bold text-gray-900 tracking-wider">{timeText}</span>
            </div>

            <div>
              <div className="w-full px-4 py-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm flex flex-col items-center justify-center gap-3">
                {location ? (
                  <span className="text-green-600 font-bold flex items-center gap-2">✅ ดึงพิกัดสำเร็จ ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})</span>
                ) : (
                  <button type="button" onClick={fetchLocation} disabled={isFetching} className="bg-white text-gray-800 border border-gray-300 px-4 py-3 rounded-lg font-bold w-full hover:bg-gray-100 transition-colors shadow-sm">
                    {isFetching ? '⏳ กำลังค้นหา...' : '📍 กดเพื่อดึงพิกัด GPS'}
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">สรุปงานประจำวัน</label>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-gray-900 text-base h-28 resize-none" placeholder="วันนี้ทำอะไรไปบ้าง..." required></textarea>
            </div>
            
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 text-center">
                {errorMsg}
              </div>
            )}

            <button type="submit" className={`w-full py-4 rounded-xl font-bold text-lg transition-colors shadow-lg ${location && summary.trim() && !isSubmitting ? 'bg-gray-900 text-white hover:bg-black' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`} disabled={!location || !summary.trim() || isSubmitting}>{isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันออกงาน'}</button>
          </form>

          {showPopup && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 animate-fade-in">
              <div className="bg-white w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-5xl mx-auto mb-6 text-green-500">🏡</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">ออกงานสำเร็จ!</h3>
                <p className="text-gray-500 mb-8">บันทึกเวลาและสรุปงานเรียบร้อย เดินทางกลับบ้านปลอดภัยครับ</p>
                <button onClick={closeLiff} className="w-full bg-gray-900 text-white py-3.5 rounded-xl font-bold text-lg hover:bg-black">ปิดหน้าต่าง</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}