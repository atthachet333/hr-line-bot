'use client';

import { useState, useEffect } from 'react';
import liff from '@line/liff';

export default function LeaveBalancePage() {
  const [activeTab, setActiveTab] = useState('balance');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(''); 
  
  const [balances, setBalances] = useState([
    { type: 'ลาป่วย', total: 30, used: 0, icon: '🤒' },
    { type: 'ลากิจ', total: 6, used: 0, icon: '💼' },
    { type: 'ลาพักร้อน', total: 6, used: 0, icon: '🌴' },
  ]);
  const [histories, setHistories] = useState<any[]>([]);

  useEffect(() => {
    const init = async () => {
      try {
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID_BALANCE as string });
        
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          setUserId(profile.userId);
          
          // ✅ เปลี่ยนมายิงเข้า API Route ของตัวเองแทน เพื่อแก้ปัญหา Load Failed
          const res = await fetch('/api/balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ action: 'getBalance', userId: profile.userId })
          });
          
          if (res.ok) {
            const result = await res.json();
            if (result.status === 'success' && result.data) {
              setBalances([
                { type: 'ลาป่วย', total: result.data.sickTotal || 30, used: result.data.sickUsed || 0, icon: '🤒' },
                { type: 'ลากิจ', total: result.data.personalTotal || 6, used: result.data.personalUsed || 0, icon: '💼' },
                { type: 'ลาพักร้อน', total: result.data.annualTotal || 6, used: result.data.annualUsed || 0, icon: '🌴' },
              ]);
              setHistories(result.data.history || []);
            }
          }
        } else {
          liff.login();
        }
      } catch (err) {
        console.warn("ไม่สามารถดึงข้อมูลจาก Server ได้ แสดงผลด้วยค่า Default แทน", err);
      } finally {
        setLoading(false); 
      }
    };
    init();
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'); .font-prompt { font-family: 'Prompt', sans-serif; }`}} />
      <div className="min-h-screen bg-gray-100 flex justify-center font-prompt text-black">
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl sm:rounded-3xl sm:my-8 sm:min-h-[calc(100vh-4rem)] overflow-hidden relative">
          
          <div className="bg-blue-600 pt-10 pb-6 px-6 text-center text-white">
            <h1 className="text-2xl font-bold tracking-wide mb-6">ข้อมูลวันลาของคุณ</h1>
            <div className="flex bg-blue-700 p-1 rounded-xl">
              <button onClick={() => setActiveTab('balance')} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'balance' ? 'bg-white text-blue-600 shadow' : 'text-blue-100'}`}>
                สิทธิ์คงเหลือ
              </button>
              <button onClick={() => setActiveTab('history')} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'history' ? 'bg-white text-blue-600 shadow' : 'text-blue-100'}`}>
                ประวัติการลา
              </button>
            </div>
          </div>

          <div className="p-6 h-full bg-gray-50">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
                 <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                 <div className="text-gray-500 font-medium">กำลังโหลดข้อมูล...</div>
              </div>
            ) : (
              <>
                {activeTab === 'balance' && (
                  <div className="space-y-4 animate-fade-in">
                    {balances.map((item, index) => (
                      <div key={index} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-blue-50 shadow-inner">{item.icon}</div>
                          <div>
                            <h3 className="font-bold text-gray-900">{item.type}</h3>
                            <p className="text-xs text-gray-500">ใช้ไปแล้ว {item.used} / {item.total} วัน</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-2xl font-bold text-blue-600">{item.total - item.used}</span>
                          <span className="text-xs text-gray-400 block mt-0.5">คงเหลือ</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'history' && (
                  <div className="space-y-3 animate-fade-in">
                    {histories.length > 0 ? (
                      histories.map((item, index) => (
                        <div key={index} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center">
                          <div>
                            <h4 className="font-bold text-gray-900 text-sm">{item.type}</h4>
                            <p className="text-xs text-gray-500 mt-1">{item.date}</p>
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${item.statusColor}`}>
                            {item.status}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm mt-4">
                        <div className="text-5xl mb-4 opacity-70">📭</div>
                        <h3 className="text-gray-900 font-bold mb-1">ยังไม่มีประวัติการลางาน</h3>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}