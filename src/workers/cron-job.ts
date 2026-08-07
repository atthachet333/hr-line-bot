import { loadEnvConfig } from '@next/env';
import cron from 'node-cron';
import { buildDailyReportFlex } from '@/lib/line/daily-report-flex';

// Load .env AND .env.local so NEXT_PUBLIC_LIFF_ID_* are available to the builder.
loadEnvConfig(process.cwd());

console.log('🤖 Cron Job Service for LINE Group is running...');

// ⏰ ตั้งเวลาทำงานทุกวัน ตอนตี 5 ตรง (0 5 * * *)
cron.schedule('0 5 * * *', async () => {
  console.log('⏰ Executing Daily Report for LINE Group...');

  try {
    // Channel access token comes from the environment — never hardcode a secret.
    const token = process.env.MANAGER_LINE_CHANNEL_ACCESS_TOKEN || '';
    if (!token) {
      console.error('Cron: MANAGER_LINE_CHANNEL_ACCESS_TOKEN is not set; skipping daily group report.');
      return;
    }

    // Button URLs are canonical LIFF deep links resolved from env (no hardcoding).
    const flexMessage = buildDailyReportFlex(process.env);

    // คำสั่งยิงเข้า "กลุ่มไลน์" เท่านั้น (Push)
    const pushResponse = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: "C98a97bd91b757551364dc1a62acf4d1e", // รหัสกลุ่มไลน์ของคุณ
        messages: flexMessage
      })
    });
    
    const pushResult = await pushResponse.json();
    console.log('สถานะการส่งเข้ากลุ่ม:', pushResult);

  } catch (error) {
    console.error('Cron Error:', error);
  }
}, {
  timezone: 'Asia/Bangkok'
});