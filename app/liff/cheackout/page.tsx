'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';

export default function CheckOutPage() {
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      );
    }
    liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID || '' }).catch(console.error);
    return () => clearInterval(timer);
  }, []);

  const handleCheckOut = (e: React.FormEvent) => {
    e.preventDefault();
    alert('บันทึกเวลาออกงานและสรุปงานเรียบร้อย!');
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt { font-family: 'Prompt', sans-serif; }`}} />
      <div className="min-h-screen bg-gray-100 flex justify-center font-prompt text-black">
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden relative pb-24">
          
          <div className="bg-white pt-10 pb-6 px-6 text-center border-b border-gray-100">
            <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center text-3xl mb-4 shadow-lg text-white mx-auto"> 🏃 </div>
            <h1 className="text-2xl font-bold text-gray-900">แจ้งออกงาน</h1>
          </div>

          <form onSubmit={handleCheckOut} className="px-8 py-6 space-y-5">
            <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
              <span className="text-gray-600 font-medium">เวลาออกงาน</span>
              <span className="text-xl font-bold text-gray-900">{currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">สรุปงานประจำวัน</label>
              <textarea className="w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 text-base text-black h-32 resize-none" placeholder="วันนี้ทำอะไรไปบ้าง..." required></textarea>
            </div>
            
            <div className="pt-4">
              <button type="submit" className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-black transition-colors shadow-lg">
                ยืนยันออกงาน
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}