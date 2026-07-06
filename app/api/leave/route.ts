import { NextResponse } from 'next/server';
import { getGoogleSheets } from '@/lib/google';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { empId, name, leaveType, startDate, endDate, reason } = body;

    // --- 1. บันทึกลง Google Sheets (เหมือนเดิม) ---
    const { googleSheets, spreadsheetId } = await getGoogleSheets();
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const id = `REQ-${Date.now()}`;
    
    await googleSheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId as string,
      range: 'LeaveRequests!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[id, timestamp, empId, name, leaveType, startDate, endDate, reason, 'รออนุมัติ']] },
    });

    // --- 2. ส่งแจ้งเตือนเข้า LINE Group (ส่วนที่เพิ่มเข้ามา) ---
    // ใช้ Channel Access Token จาก .env.local ของคุณ
    const message = `🔔 มีคำขอลางานใหม่!\n\n` +
                    `👤 ชื่อ: ${name} (รหัส: ${empId})\n` +
                    `📝 ประเภท: ${leaveType}\n` +
                    `📅 วันที่: ${startDate} ถึง ${endDate}\n` +
                    `💬 เหตุผล: ${reason}\n\n` +
                    `คลิกดูรายละเอียดใน Sheet ได้เลยครับ`;

    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` // ต้องมีค่านี้นะครับ
      },
      body: JSON.stringify({
        to: process.env.MANAGER_USER_ID, // ใส่ Group ID หรือ User ID ตรงนี้
        messages: [{ type: 'text', text: message }]
      })
    });

    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}