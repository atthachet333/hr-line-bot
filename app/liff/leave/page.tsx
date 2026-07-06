'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';

export default function LeaveFormPage() {
  const [isLiffReady, setIsLiffReady] = useState(false);
  const [selectedLeaveType, setSelectedLeaveType] = useState('');

  useEffect(() => {
    const initLiff = async () => {
      try {
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID || '' });
        setIsLiffReady(true);
      } catch (error) {
        console.error('LIFF Init Error:', error);
      }
    };
    initLiff();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault(); // **บรรทัดนี้ต้องอยู่บนสุด** เพื่อหยุดการรีเฟรชหน้าเว็บ
  
  // สร้างตัวโหลดหรือคำแจ้งเตือน
  const submitBtn = e.currentTarget.querySelector('button[type="submit"]') as HTMLButtonElement;
  submitBtn.disabled = true;
  submitBtn.innerText = 'กำลังส่ง...';

  try {
    const formData = new FormData(e.currentTarget);
    const data = {
      empId: formData.get('empId'),
      name: formData.get('empName'),
      // ... (ดึงข้อมูลส่วนที่เหลือเหมือนเดิม)
    };

    const response = await fetch('/api/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    
    if (result.success) {
      alert('✅ ส่งข้อมูลสำเร็จ!');
      // ถ้าอยู่บน LINE ให้ปิดหน้าต่าง
      if (liff.isInClient()) liff.closeWindow();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error(error);
    alert('❌ ส่งข้อมูลไม่สำเร็จ: ' + error);
    submitBtn.disabled = false;
    submitBtn.innerText = 'ส่งคำขอ';
  }
};

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap');
        .font-prompt { font-family: 'Prompt', sans-serif; }
      `}} />

      <div className="min-h-screen bg-gray-100 flex justify-center font-prompt text-black">
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden relative pb-24">
          
          {/* Header */}
          <div className="bg-white pt-10 pb-6 px-6 text-center z-10 relative border-b border-gray-100">
            <div className="flex flex-col items-center justify-center">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-3xl mb-4 shadow-lg text-white">
                📝
              </div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-wide">แบบฟอร์มลางาน</h1>
              <p className="text-sm text-gray-500 mt-1">กรุณากรอกข้อมูลให้ครบถ้วน</p>
            </div>
          </div>

          {/* Form Body - เพิ่ม attribute 'name' ในทุกๆ input */}
          <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5 bg-white">
            
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">รหัสพนักงาน</label>
              <input type="text" name="empId" className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 transition-colors text-base text-black" placeholder="เช่น EMP-001" required />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">ชื่อ-นามสกุล</label>
              <input type="text" name="empName" className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 transition-colors text-base text-black" placeholder="ระบุชื่อและนามสกุล" required />
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">ตำแหน่ง</label>
                <input type="text" name="position" className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 transition-colors text-base text-black" placeholder="ระบุตำแหน่ง" required />
              </div>
               <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">แผนก</label>
                <input type="text" name="department" className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 transition-colors text-base text-black" placeholder="ระบุแผนก" required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-3">ประเภทการลา</label>
              <div className="grid grid-cols-2 gap-3">
                {['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'ลาอื่นๆ'].map((type) => (
                  <label key={type} className="flex items-center p-3.5 bg-white border-2 border-gray-200 rounded-xl cursor-pointer hover:border-blue-400 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-all group">
                    <input 
                      type="radio" 
                      name="leaveType" 
                      value={type} 
                      onChange={(e) => setSelectedLeaveType(e.target.value)}
                      className="w-4 h-4 text-blue-600 border-gray-300" 
                      required 
                    />
                    <span className="ml-3 text-sm font-medium text-gray-800">{type}</span>
                  </label>
                ))}
              </div>
              
              {/* ช่องลาอื่นๆ */}
              {selectedLeaveType === 'ลาอื่นๆ' && (
                <div className="mt-3 animate-fade-in-down">
                  <input 
                    type="text" 
                    name="leaveTypeOther"
                    className="w-full px-4 py-3.5 bg-blue-50 border-2 border-blue-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 text-base text-black" 
                    placeholder="โปรดระบุประเภทการลาของคุณ..." 
                    required={selectedLeaveType === 'ลาอื่นๆ'} 
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">วันที่เริ่มต้น</label>
                <input type="date" name="startDate" className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 text-base text-black" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">ถึงวันที่</label>
                <input type="date" name="endDate" className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 text-base text-black" required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">เหตุผลการลา</label>
              <textarea name="reason" className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-600 focus:ring-0 text-base text-black h-28 resize-none" placeholder="ระบุเหตุผลที่ต้องการลางาน..." required></textarea>
            </div>
            
            <div className="h-8"></div>

            <div className="absolute bottom-0 left-0 w-full bg-white border-t-2 border-gray-100 p-5 flex gap-4 rounded-b-none sm:rounded-b-3xl">
              <button type="button" onClick={() => alert('ยกเลิก')} className="flex-[0.35] bg-gray-200 text-black py-4 rounded-xl font-bold hover:bg-gray-300 transition-colors">
                ยกเลิก
              </button>
              <button type="submit" className="flex-[0.65] bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 text-lg">
                ส่งคำขอ
              </button>
            </div>
          </form>

        </div>
      </div>
    </>
  );
}