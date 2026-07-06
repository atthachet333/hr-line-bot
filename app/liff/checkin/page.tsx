'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';

export default function CheckInPage() {
  const [isReady, setIsReady] = useState(false);
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [locationError, setLocationError] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    // อัปเดตเวลาแบบ Real-time
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    
    // ดึงตำแหน่ง GPS
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => setLocationError('ไม่สามารถดึงตำแหน่งได้ กรุณาเปิด GPS')
      );
    } else {
      setLocationError('เบราว์เซอร์ของคุณไม่รองรับ GPS');
    }

    const initLiff = async () => {
      try {
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID || '' });
        setIsReady(true);
        if (!liff.isLoggedIn()) liff.login();
      } catch (error) { console.error('LIFF Init Error:', error); }
    };
    initLiff();

    return () => clearInterval(timer);
  }, []);

  const handleCheckIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) return alert('กรุณารอระบบดึงพิกัด GPS ก่อนกดยืนยัน');
    alert(`บันทึกเวลาเข้างาน: ${currentTime.toLocaleTimeString()} \nพิกัด: ${location.lat}, ${location.lng}`);
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt { font-family: 'Prompt', sans-serif; }`}} />
      <div className="min-h-screen bg-gray-100 flex justify-center font-prompt text-black">
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden relative">
          
          <div className="bg-white pt-10 pb-6 px-6 text-center border-b border-gray-100">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-3xl mb-4 shadow-lg text-white mx-auto"> 📍 </div>
            <h1 className="text-2xl font-bold text-gray-900">แจ้งเข้างาน</h1>
          </div>

          <form onSubmit={handleCheckIn} className="px-8 py-8 space-y-6">
            <div className="text-center bg-gray-50 p-6 rounded-2xl border-2 border-gray-100">
              <p className="text-sm text-gray-500 mb-1">เวลาปัจจุบัน</p>
              <h2 className="text-4xl font-bold text-blue-600 tracking-wider">
                {currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </h2>
              <p className="text-sm text-gray-700 mt-2">{currentTime.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">ตำแหน่งของคุณ (GPS)</label>
              <div className="w-full px-4 py-4 bg-white border-2 border-gray-200 rounded-xl text-sm flex items-center justify-between">
                {location ? (
                  <span className="text-green-600 font-medium flex items-center gap-2">✅ ดึงพิกัดสำเร็จ ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})</span>
                ) : locationError ? (
                  <span className="text-red-500">{locationError}</span>
                ) : (
                  <span className="text-gray-500 animate-pulse">กำลังค้นหาพิกัด...</span>
                )}
              </div>
            </div>

            <div className="pt-8">
              <button type="submit" className={`w-full py-4 rounded-xl font-bold text-lg transition-colors shadow-lg ${location ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`} disabled={!location}>
                ยืนยันเข้างาน
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}